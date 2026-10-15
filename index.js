import './env.js';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import multer from 'multer';
import { z } from 'zod';
import { pool, transaction } from './db.js';
import { hash, sendPasswordLink } from './mail.js';
import { passwordSchema } from './password.js';
import { adminUserSchema, registerSchema, configSchema, editSchema, validateTerms, validCPF } from './domain.js';
import { allowedOrigins, originGuard } from './origin.js';
import { financingFromAmount } from '../src/financing.js';
import { consultVehicle, selectVehicleOption, vehicleConfigured } from './placa-fipe.js';
import { refreshDraft, refreshAllDrafts } from './simulation-parameters.js';

const app=express();
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const uploadDir=process.env.DOCUMENTS_DIR || path.join(root,'private','documents');
await mkdir(uploadDir,{recursive:true});
app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:{directives:{'script-src':["'self'"],'img-src':["'self'",'data:'],'style-src':["'self'","'unsafe-inline'"]}}}));
app.use(express.json({limit:'32kb'}));
app.use('/api',originGuard(allowedOrigins()));
app.use('/api',rateLimit({windowMs:60000,limit:180,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Muitas solicitações. Aguarde um minuto.'}}));
const authLimiter=rateLimit({windowMs:15*60000,limit:25,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Muitas tentativas. Aguarde 15 minutos.'}});
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const audit=(c,user,action,id,details={})=>c.query('INSERT INTO auditoria(usuario_id,acao,entidade_id,detalhes) VALUES($1,$2,$3,$4)',[user,action,id,details]);
const publicUser=u=>({id:u.id,nome:u.nome,email:u.email,perfil:u.perfil,loja_id:u.loja_id,loja_nome:u.loja_nome});
const getToken=req=>req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('gmv_session='))?.slice(12);
const cookieOptions={httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/'};
async function auth(req,res,next){
  const token=getToken(req); if(!token) return res.status(401).json({error:'Faça login para continuar.'});
  const {rows:[user]}=await pool.query("SELECT u.*,l.nome AS loja_nome FROM sessao s JOIN usuario u ON u.id=s.usuario_id LEFT JOIN loja l ON l.id=u.loja_id WHERE s.token_hash=$1 AND s.expira_em>now() AND u.status='ATIVO'",[hash(token)]);
  if(!user) return res.status(401).json({error:'Sessão expirada ou acesso desabilitado.'});
  req.user=user;next();
}
const admin=(req,res,next)=>req.user.perfil==='ADMIN'?next():res.status(403).json({error:'Acesso exclusivo de administradores.'});
async function simulation(c,id,user,lock=false){
  if(!z.uuid().safeParse(id).success) fail(404,'Simulação não encontrada.');
  const {rows:[s]}=await c.query(`SELECT * FROM simulacao WHERE id=$1 AND ($2::boolean OR loja_id=$3::uuid) ${lock?'FOR UPDATE':''}`,[id,user.perfil==='ADMIN',user.loja_id]);
  if(!s) fail(404,'Simulação não encontrada.');
  if(lock && s.status==='SIMULACAO'){
    const {rows:[p]}=await c.query('SELECT * FROM parametro_financiamento WHERE id=1');
    return refreshDraft(c,s,p);
  }
  return s;
}
app.get('/api/health',async(req,res)=>{await pool.query('SELECT 1');res.json({status:'ok'});});
app.post('/api/auth/register',authLimiter,async(req,res)=>{
  const data=registerSchema.parse(req.body);
  await transaction(async c=>{
    const lojaId=crypto.randomUUID(),userId=crypto.randomUUID();
    await c.query('INSERT INTO loja(id,nome,cnpj,representante,telefone) VALUES($1,$2,$3,$4,$5)',[lojaId,data.loja,data.cnpj,data.nome,data.telefone]);
    await c.query('INSERT INTO usuario(id,loja_id,nome,email) VALUES($1,$2,$3,$4)',[userId,lojaId,data.nome,data.email]);
    await audit(c,userId,'CADASTRO_SOLICITADO',userId,{aceite:true});
  });res.status(201).json({message:'Solicitação registrada. Após aprovação, você receberá um e-mail para criar sua senha.'});
});
app.post('/api/auth/login',authLimiter,async(req,res)=>{
  const {email,password}=z.object({email:z.email(),password:z.string().min(1).max(128)}).parse(req.body);
  const {rows:[u]}=await pool.query("SELECT u.*,l.nome AS loja_nome FROM usuario u LEFT JOIN loja l ON l.id=u.loja_id WHERE email=$1",[email.toLowerCase()]);
  const dummy='$2b$12$5dwBkTOU2Fp5/CWCkoEYleuZY1DDIFqeWhENgzOhLD4/qdXYqSNgC';
  const valid=await bcrypt.compare(password,u?.senha_hash||dummy);
  if(!u||!valid||u.status!=='ATIVO') fail(401,'E-mail ou senha inválidos, ou acesso ainda não liberado.');
  const token=crypto.randomBytes(32).toString('hex');
  await pool.query("INSERT INTO sessao(token_hash,usuario_id,expira_em) VALUES($1,$2,now()+interval '8 hours')",[hash(token),u.id]);
  res.cookie('gmv_session',token,{...cookieOptions,maxAge:8*60*60*1000}).json(publicUser(u));
});
app.post('/api/auth/forgot',authLimiter,async(req,res)=>{
  const email=z.email().parse(req.body.email).toLowerCase();
  const {rows:[u]}=await pool.query("SELECT * FROM usuario WHERE email=$1 AND status IN ('ATIVO','CONVIDADO')",[email]);
  if(u) {try{await sendPasswordLink(u,u.status==='CONVIDADO'?'CONVITE':'RECUPERACAO');}catch{ /* Status operacional disponível ao administrador. */ }}
  res.json({message:'Se houver um cadastro elegível, você receberá um link para definir sua senha.'});
});
app.post('/api/auth/reset',authLimiter,async(req,res)=>{
  const {token,password}=z.object({token:z.string().regex(/^[a-f0-9]{64}$/),password:passwordSchema}).parse(req.body);
  const passwordHash=await bcrypt.hash(password,12);
  await transaction(async c=>{
    const {rows:[t]}=await c.query('SELECT * FROM token_senha WHERE token_hash=$1 AND usado_em IS NULL AND expira_em>now() FOR UPDATE',[hash(token)]);
    if(!t) fail(400,'Link inválido ou expirado. Solicite um novo link.');
    const {rows:[u]}=await c.query("SELECT * FROM usuario WHERE id=$1 AND status IN ('ATIVO','CONVIDADO') FOR UPDATE",[t.usuario_id]);
    if(!u) fail(400,'Acesso não liberado.');
    await c.query("UPDATE usuario SET senha_hash=$1,status='ATIVO' WHERE id=$2",[passwordHash,u.id]);
    await c.query('UPDATE token_senha SET usado_em=now() WHERE usuario_id=$1 AND usado_em IS NULL',[u.id]);
    await c.query('DELETE FROM sessao WHERE usuario_id=$1',[u.id]);await audit(c,u.id,'SENHA_DEFINIDA',u.id);
  });res.json({message:'Senha definida. Você já pode entrar.'});
});
app.get('/api/auth/me',auth,(req,res)=>res.json(publicUser(req.user)));
app.post('/api/auth/logout',async(req,res)=>{const token=getToken(req);if(token)await pool.query('DELETE FROM sessao WHERE token_hash=$1',[hash(token)]);res.clearCookie('gmv_session',cookieOptions).json({ok:true});});
app.post('/api/auth/password',auth,authLimiter,async(req,res)=>{
  const {current,password}=z.object({current:z.string().max(128),password:passwordSchema}).parse(req.body);
  if(!await bcrypt.compare(current,req.user.senha_hash))fail(400,'Senha atual incorreta.');
  const passwordHash=await bcrypt.hash(password,12);
  await transaction(async c=>{await c.query('UPDATE usuario SET senha_hash=$1 WHERE id=$2',[passwordHash,req.user.id]);await c.query('DELETE FROM sessao WHERE usuario_id=$1',[req.user.id]);await c.query('DELETE FROM token_senha WHERE usuario_id=$1',[req.user.id]);await audit(c,req.user.id,'SENHA_ALTERADA',req.user.id);});
  res.clearCookie('gmv_session',cookieOptions).json({message:'Senha alterada. Entre novamente.'});
});
app.use('/api',auth);
app.get('/api/config',async(req,res)=>{const {rows:[p]}=await pool.query('SELECT * FROM parametro_financiamento WHERE id=1');res.json(p);});
app.get('/api/integrations',(req,res)=>res.json({vehicle:vehicleConfigured(),credit:false,ocr:false,signature:false,message:vehicleConfigured()?'Consulta de placa/FIPE configurada. Crédito, OCR e assinatura aguardam configuração.':'Configure o token Placa Fipe. Crédito, OCR e assinatura aguardam configuração.'}));
app.get('/api/lojas',async(req,res)=>{const {rows}=await pool.query('SELECT id,nome FROM loja WHERE ($1::boolean OR id=$2::uuid) ORDER BY nome',[req.user.perfil==='ADMIN',req.user.loja_id]);res.json(rows);});
app.get('/api/simulations',async(req,res)=>{
  const rows=await transaction(async c=>{
    const {rows}=await c.query('SELECT s.*,l.nome AS loja_nome FROM simulacao s JOIN loja l ON l.id=s.loja_id WHERE s.id IN (SELECT id FROM simulacao WHERE ($1::boolean OR loja_id=$2::uuid) ORDER BY atualizada_em DESC LIMIT 100) ORDER BY s.id FOR UPDATE OF s',[req.user.perfil==='ADMIN',req.user.loja_id]);
    const {rows:[p]}=await c.query('SELECT * FROM parametro_financiamento WHERE id=1');
    const updated=[];for(const row of rows)updated.push(await refreshDraft(c,row,p));
    return updated.sort((a,b)=>new Date(b.atualizada_em)-new Date(a.atualizada_em));
  });res.json(rows);
});
app.post('/api/simulations',async(req,res)=>{
  const lojaId=req.user.perfil==='ADMIN'?z.uuid().parse(req.body.loja_id):req.user.loja_id;
  const {rows:[p]}=await pool.query('SELECT * FROM parametro_financiamento WHERE id=1');
  const {rows:[s]}=await pool.query('INSERT INTO simulacao(id,loja_id,usuario_id,percentual,parcelas,taxa_mensal,parametros) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[crypto.randomUUID(),lojaId,req.user.id,p.percentual_max,p.parcelas_max,p.taxa_mensal,p]);res.status(201).json(s);
});
app.get('/api/simulations/:id',async(req,res)=>res.json(await transaction(c=>simulation(c,req.params.id,req.user,true))));
app.patch('/api/simulations/:id',async(req,res)=>{
  const d=editSchema.parse(req.body);
  const updated=await transaction(async c=>{
    const s=await simulation(c,req.params.id,req.user,true);
    if(s.status!=='SIMULACAO')fail(409,'A proposta já foi enviada; seus dados estão preservados.');
    if(s.versao!==d.versao)fail(409,'Esta simulação foi alterada em outra sessão. Reabra para atualizar.');
    const vehicleChanged=d.placa!==s.placa,clientChanged=d.cpf!==s.cpf;
    const fipe=vehicleChanged?null:s.valor_fipe;
    let values={valor_financiado:null,valor_parcela:null,percentual:Number(s.parametros.percentual_min)};
    try{
      if(!vehicleChanged && d.valor_financiado!==null) values=financingFromAmount(fipe,d.valor_financiado,d.parcelas,Number(s.taxa_mensal),s.parametros);
      validateTerms(s.parametros,values.percentual,d.parcelas,vehicleChanged?null:s.veiculo.ano_modelo);
    }catch(e){fail(400,e.message);}
    const {rows:[r]}=await c.query(`UPDATE simulacao SET placa=$1,cpf=$2,percentual=$3,parcelas=$4,veiculo=$5,cliente=$6,valor_fipe=$7,valor_financiado=$8,valor_parcela=$9,consulta_veiculo_status=$10,consulta_cliente_status=$11,versao=versao+1,atualizada_em=now() WHERE id=$12 RETURNING *`,[d.placa,d.cpf,values.percentual,d.parcelas,vehicleChanged?{}:s.veiculo,clientChanged?{}:s.cliente,fipe,values.valor_financiado,values.valor_parcela,vehicleChanged?'PENDENTE':s.consulta_veiculo_status,clientChanged?'PENDENTE':s.consulta_cliente_status,s.id]);return r;
  });res.json(updated);
});
app.post('/api/simulations/:id/consult',async(req,res)=>{
  const result=await transaction(async c=>{
    const s=await simulation(c,req.params.id,req.user,true);
    if(s.status!=='SIMULACAO')fail(409,'Esta proposta já foi enviada.');
    if(['CONCLUIDA','SELECAO_PENDENTE'].includes(s.consulta_veiculo_status))return {simulation:s};
    let vehicle;
    try { vehicle=await consultVehicle(s.placa); }
    catch(e){
      if(!e.status)throw e;
      await c.query("UPDATE simulacao SET consulta_veiculo_status='ERRO',versao=versao+1,atualizada_em=now() WHERE id=$1",[s.id]);
      await audit(c,req.user.id,'CONSULTA_VEICULO_ERRO',s.id,{fornecedor:'placa_fipe',status:e.status});
      return {error:e};
    }
    const single=vehicle.opcoes_fipe.length===1;
    if(single)vehicle=selectVehicleOption(vehicle,0);
    const {rows:[updated]}=await c.query('UPDATE simulacao SET veiculo=$1,valor_fipe=$2,valor_financiado=NULL,valor_parcela=NULL,consulta_veiculo_status=$3,versao=versao+1,atualizada_em=now() WHERE id=$4 RETURNING *',[vehicle,single?vehicle.valor_fipe:null,single?'CONCLUIDA':'SELECAO_PENDENTE',s.id]);
    await audit(c,req.user.id,'VEICULO_CONSULTADO',s.id,{fornecedor:'placa_fipe',quantidade_modelos:vehicle.opcoes_fipe.length,consultado_em:vehicle.consultado_em});
    return {simulation:updated};
  });
  if(result.error)throw result.error;
  res.json(result.simulation);
});
app.post('/api/simulations/:id/vehicle-selection',async(req,res)=>{
  const data=z.object({versao:z.number().int().positive(),index:z.number().int().nonnegative()}).parse(req.body);
  const updated=await transaction(async c=>{
    const s=await simulation(c,req.params.id,req.user,true);
    if(s.status!=='SIMULACAO'||s.versao!==data.versao)fail(409,'A simulação foi alterada. Reabra para atualizar.');
    if(!['SELECAO_PENDENTE','CONCLUIDA'].includes(s.consulta_veiculo_status))fail(409,'Consulte o veículo antes de selecionar o modelo.');
    const vehicle=selectVehicleOption(s.veiculo,data.index);
    const {rows:[r]}=await c.query("UPDATE simulacao SET veiculo=$1,valor_fipe=$2,valor_financiado=NULL,valor_parcela=NULL,consulta_veiculo_status='CONCLUIDA',versao=versao+1,atualizada_em=now() WHERE id=$3 RETURNING *",[vehicle,vehicle.valor_fipe,s.id]);
    await audit(c,req.user.id,'MODELO_FIPE_SELECIONADO',s.id,{codigo_fipe:vehicle.codigo_fipe,index:data.index});return r;
  });res.json(updated);
});
app.post('/api/simulations/:id/submit',async(req,res)=>{
  const proposal=await transaction(async c=>{
    const s=await simulation(c,req.params.id,req.user,true);
    const {rows:[existing]}=await c.query('SELECT * FROM proposta WHERE simulacao_id=$1',[s.id]);if(existing)return existing;
    if(s.status!=='SIMULACAO')fail(409,'Estado inválido para envio.');
    if(s.consulta_veiculo_status!=='CONCLUIDA'||s.consulta_cliente_status!=='CONCLUIDA'||!s.valor_fipe||!s.veiculo.ano_modelo||!validCPF(s.cpf))fail(400,'Conclua as consultas de veículo e crédito antes de enviar.');
    if(!s.valor_financiado)fail(400,'Informe o valor financiado antes de enviar.');
    const {rows:[p]}=await c.query('SELECT * FROM parametro_financiamento WHERE id=1');
    if(req.body?.parametros_versao!==p.versao)fail(409,'Os parâmetros foram atualizados. Confira as condições atuais e envie novamente.');
    try{
      const terms=financingFromAmount(s.valor_fipe,Number(s.valor_financiado),s.parcelas,Number(s.taxa_mensal),p);
      validateTerms(p,terms.percentual,s.parcelas,s.veiculo.ano_modelo);
      Object.assign(s,terms);
    }catch(e){fail(400,e.message);}
    const {rows:[proposal]}=await c.query('INSERT INTO proposta(id,simulacao_id,loja_id,dados) VALUES($1,$2,$3,$4) RETURNING *',[crypto.randomUUID(),s.id,s.loja_id,s]);
    await c.query("UPDATE simulacao SET status='EM_ANALISE',versao=versao+1,atualizada_em=now() WHERE id=$1",[s.id]);await audit(c,req.user.id,'PROPOSTA_ENVIADA',proposal.id);return proposal;
  });res.json(proposal);
});
app.get('/api/proposals',async(req,res)=>{const {rows}=await pool.query('SELECT p.*,l.nome AS loja_nome FROM proposta p JOIN loja l ON l.id=p.loja_id WHERE ($1::boolean OR p.loja_id=$2::uuid) ORDER BY p.criada_em DESC LIMIT 100',[req.user.perfil==='ADMIN',req.user.loja_id]);res.json(rows);});
app.post('/api/admin/proposals/:id/decision',admin,async(req,res)=>{
  const {decision,motivo}=z.object({decision:z.enum(['APROVADA','REPROVADA']),motivo:z.string().trim().max(1000).default('')}).parse(req.body);
  if(decision==='REPROVADA'&&!motivo)fail(400,'Informe o motivo da reprovação.');
  const p=await transaction(async c=>{
    const {rows:[p]}=await c.query('SELECT * FROM proposta WHERE id=$1 FOR UPDATE',[z.uuid().parse(req.params.id)]);
    if(!p)fail(404,'Proposta não encontrada.');if(p.status!=='EM_ANALISE')fail(409,'Esta proposta já foi analisada.');
    const {rows:[r]}=await c.query('UPDATE proposta SET status=$1,motivo=$2,analisada_por=$3,analisada_em=now() WHERE id=$4 RETURNING *',[decision,motivo,req.user.id,p.id]);
    await c.query('UPDATE simulacao SET status=$1,versao=versao+1,atualizada_em=now() WHERE id=$2',[decision,p.simulacao_id]);await audit(c,req.user.id,'PROPOSTA_'+decision,p.id,{motivo});return r;
  });res.json(p);
});
async function accessibleProposal(req){
 const {rows:[p]}=await pool.query('SELECT * FROM proposta WHERE id=$1 AND ($2::boolean OR loja_id=$3::uuid)',[z.uuid().parse(req.params.id),req.user.perfil==='ADMIN',req.user.loja_id]);if(!p)fail(404,'Proposta não encontrada.');return p;
}
const upload=multer({dest:uploadDir,limits:{fileSize:10*1024*1024,files:1},fileFilter:(req,file,cb)=>cb(null,['application/pdf','image/jpeg','image/png'].includes(file.mimetype))});
app.get('/api/proposals/:id/documents',async(req,res)=>{await accessibleProposal(req);const {rows}=await pool.query('SELECT id,tipo,nome_original,status,criado_em FROM documento WHERE proposta_id=$1 ORDER BY criado_em DESC',[req.params.id]);res.json(rows);});
app.post('/api/proposals/:id/documents',async(req,res,next)=>{const p=await accessibleProposal(req);if(p.status!=='APROVADA')fail(409,'Os documentos são liberados após aprovação.');next();},upload.single('file'),async(req,res)=>{
  try{
    const tipo=z.enum(['CNH','CRLV']).parse(req.body.tipo);if(!req.file)fail(400,'Envie um PDF, JPG ou PNG de até 10 MB.');
    const bytes=await readFile(req.file.path);
    const detected=bytes.subarray(0,5).toString()==='%PDF-'?'application/pdf':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':null;
    if(!detected||detected!==req.file.mimetype)fail(400,'O conteúdo do arquivo não corresponde ao formato informado.');
    const id=crypto.randomUUID();
    await transaction(async c=>{await c.query('INSERT INTO documento(id,proposta_id,tipo,nome_original,arquivo,mime,tamanho,sha256,enviado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,req.params.id,tipo,path.basename(req.file.originalname),req.file.filename,detected,req.file.size,hash(bytes),req.user.id]);await audit(c,req.user.id,'DOCUMENTO_ENVIADO',id,{tipo});});
    res.status(201).json({id,message:'Documento recebido. Validação automática aguardando configuração do OCR. Contrato bloqueado até validação.'});
  }catch(e){if(req.file)await unlink(req.file.path).catch(()=>{});throw e;}
});
app.get('/api/proposals/:id/documents/:docId/download',async(req,res)=>{
  await accessibleProposal(req);
  const {rows:[d]}=await pool.query('SELECT * FROM documento WHERE id=$1 AND proposta_id=$2',[z.uuid().parse(req.params.docId),req.params.id]);if(!d)fail(404,'Documento não encontrado.');
  res.download(path.join(uploadDir,d.arquivo),d.nome_original);
});
app.post('/api/proposals/:id/contract',async(req,res)=>{await accessibleProposal(req);fail(409,'Contrato indisponível: a validação documental e a integração de assinatura ainda precisam ser configuradas.');});
app.get('/api/admin/users',admin,async(req,res)=>{const {rows}=await pool.query('SELECT u.id,u.nome,u.email,u.perfil,u.status,u.criado_em,l.nome AS loja_nome,l.cnpj,l.telefone,(SELECT status FROM email_evento e WHERE e.usuario_id=u.id ORDER BY criado_em DESC LIMIT 1) AS email_status FROM usuario u LEFT JOIN loja l ON l.id=u.loja_id ORDER BY u.criado_em DESC');res.json(rows);});
app.post('/api/admin/users',admin,async(req,res)=>{
 const data=adminUserSchema.parse(req.body);
 const user=await transaction(async c=>{
   let lojaId=null;
   if(data.perfil==='LOJA'){
     if(data.nova_loja){
       lojaId=crypto.randomUUID();const l=data.nova_loja;
       await c.query('INSERT INTO loja(id,nome,cnpj,representante,telefone) VALUES($1,$2,$3,$4,$5)',[lojaId,l.nome,l.cnpj,l.representante,l.telefone]);
     }else{
       const {rows:[loja]}=await c.query('SELECT id FROM loja WHERE id=$1',[data.loja_id]);
       if(!loja)fail(400,'Loja não encontrada.');lojaId=loja.id;
     }
   }
   const {rows:[u]}=await c.query("INSERT INTO usuario(id,loja_id,nome,email,perfil,status,aprovado_por) VALUES($1,$2,$3,$4,$5,'CONVIDADO',$6) RETURNING *",[crypto.randomUUID(),lojaId,data.nome,data.email,data.perfil,req.user.id]);
   await audit(c,req.user.id,'USUARIO_CRIADO',u.id,{perfil:u.perfil,loja_id:lojaId});return u;
 });
 try{await sendPasswordLink(user,'CONVITE');}
 catch{return res.status(201).json({message:'Usuário cadastrado, mas o convite não foi enviado. Verifique o envio de e-mail e use Reenviar convite.',email_sent:false});}
 res.status(201).json({message:'Usuário cadastrado. Convite enviado por e-mail para definir a senha.',email_sent:true});
});
app.post('/api/admin/users/:id/action',admin,async(req,res)=>{
  const action=z.enum(['approve','reject','disable','enable','resend']).parse(req.body.action);
  const id=z.uuid().parse(req.params.id);if(id===req.user.id)fail(400,'Você não pode alterar seu próprio acesso aqui.');
  const user=await transaction(async c=>{
    const {rows:[u]}=await c.query('SELECT * FROM usuario WHERE id=$1 FOR UPDATE',[id]);if(!u)fail(404,'Usuário não encontrado.');
    if(u.perfil==='ADMIN'&&action!=='resend')fail(400,'A alteração de outros administradores não está disponível nesta versão.');
    const permitted={approve:['PENDENTE'],reject:['PENDENTE'],disable:['ATIVO','CONVIDADO'],enable:['DESABILITADO'],resend:['CONVIDADO']};
    if(!permitted[action].includes(u.status))fail(409,'Ação incompatível com o estado atual do usuário.');
    const status={approve:'CONVIDADO',reject:'REJEITADO',disable:'DESABILITADO',enable:u.senha_hash?'ATIVO':'CONVIDADO',resend:'CONVIDADO'}[action];
    await c.query('UPDATE usuario SET status=$1,aprovado_por=$2 WHERE id=$3',[status,req.user.id,id]);
    if(['disable','reject'].includes(action)){await c.query('DELETE FROM sessao WHERE usuario_id=$1',[id]);await c.query('DELETE FROM token_senha WHERE usuario_id=$1',[id]);}
    await audit(c,req.user.id,'USUARIO_'+action.toUpperCase(),id);return {...u,status};
  });
  if(['approve','resend'].includes(action)||(action==='enable'&&user.status==='CONVIDADO')){
    try{await sendPasswordLink(user,'CONVITE');}catch(e){return res.json({message:'Acesso aprovado, mas o e-mail não foi enviado. Use Reenviar convite após verificar o SMTP.',email_sent:false});}
  }res.json({message:'Usuário atualizado.',email_sent:true});
});
app.put('/api/admin/config',admin,async(req,res)=>{
  const d=configSchema.parse(req.body);
  const p=await transaction(async c=>{const {rows:[before]}=await c.query('SELECT * FROM parametro_financiamento WHERE id=1 FOR UPDATE');const {rows:[p]}=await c.query('UPDATE parametro_financiamento SET taxa_mensal=$1,percentual_min=$2,percentual_max=$3,parcelas_min=$4,parcelas_max=$5,verificar_ano=$6,ano_min=$7,versao=versao+1,atualizado_em=now(),atualizado_por=$8 WHERE id=1 RETURNING *',[d.taxa_mensal,d.percentual_min,d.percentual_max,d.parcelas_min,d.parcelas_max,d.verificar_ano,d.ano_min,req.user.id]);await refreshAllDrafts(c,p);await audit(c,req.user.id,'PARAMETROS_ALTERADOS','1',{antes:before,depois:p});return p;});res.json(p);
});
app.get('/api/admin/reports',admin,async(req,res)=>{
  const filter=z.object({from:z.iso.date().optional(),to:z.iso.date().optional(),loja:z.uuid().optional(),tipo:z.enum(['carro','moto','caminhao']).optional()}).parse(req.query);
  if(filter.from&&filter.to&&filter.from>filter.to)fail(400,'O início deve ser anterior ao fim do período.');
  const {rows}=await pool.query(`SELECT l.nome AS loja,COALESCE(p.dados->'veiculo'->>'tipo','Não informado') AS tipo,to_char(p.criada_em AT TIME ZONE 'America/Sao_Paulo','YYYY-MM') AS mes,count(*)::int AS quantidade,COALESCE(sum((p.dados->>'valor_financiado')::numeric),0) AS principal,COALESCE(sum((p.dados->>'valor_parcela')::numeric*(p.dados->>'parcelas')::integer),0) AS retorno FROM proposta p JOIN loja l ON l.id=p.loja_id WHERE p.status='APROVADA' AND ($1::date IS NULL OR p.criada_em >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')) AND ($2::date IS NULL OR p.criada_em < (($2::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')) AND ($3::uuid IS NULL OR p.loja_id=$3) AND ($4::text IS NULL OR p.dados->'veiculo'->>'tipo'=$4) GROUP BY l.nome,2,3 ORDER BY 3,l.nome`,[filter.from||null,filter.to||null,filter.loja||null,filter.tipo||null]);
  res.json({rows,disclaimer:'Projeções de propostas aprovadas. Não representam desembolsos, recebimentos ou lucro líquido realizado.'});
});
app.use('/api',(req,res)=>res.status(404).json({error:'Recurso não encontrado.'}));
app.use(express.static(path.join(root,'dist')));
app.get('/{*path}',(req,res)=>res.sendFile(path.join(root,'dist','index.html')));
app.use((err,req,res,next)=>{
  if(err instanceof z.ZodError)return res.status(400).json({error:err.issues.map(i=>i.message).join(' ')});
  if(err instanceof multer.MulterError)return res.status(400).json({error:'Arquivo inválido ou acima do limite de 10 MB.'});
  if(err.code==='23505')return res.status(409).json({error:'Já existe um cadastro com este e-mail ou CNPJ.'});
  if(err.code==='23503')return res.status(400).json({error:'Loja ou referência inválida.'});
  if(!err.status)console.error('Falha na operação:',err.code||err.name);
  res.status(err.status||503).json({error:err.status?err.message:'Serviço indisponível. Verifique a conexão com o banco e tente novamente.'});
});
const server=app.listen(Number(process.env.PORT||3100),process.env.HOST || '127.0.0.1',()=>console.log('GMVFinanceira disponível na porta '+(process.env.PORT||3100)));
process.on('SIGTERM',()=>server.close(()=>pool.end()));
