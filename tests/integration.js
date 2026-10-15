import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { pool, transaction } from '../server/db.js';
import { hash } from '../server/mail.js';
const base=process.env.TEST_API_BASE||'http://127.0.0.1:3100/api';
const ids={a:crypto.randomUUID(),b:crypto.randomUUID(),ua:crypto.randomUUID(),ub:crypto.randomUUID(),admin:crypto.randomUUID()};
const tokens={a:crypto.randomBytes(32).toString('hex'),b:crypto.randomBytes(32).toString('hex'),admin:crypto.randomBytes(32).toString('hex')};
let count=0;
async function request(url,method='GET',body,actor='a',expected=200){
 const form=body instanceof FormData;
 const r=await fetch(base+url,{method,headers:{'X-GMV-Request':'1',Cookie:'gmv_session='+tokens[actor],...(body&&!form?{'Content-Type':'application/json'}:{})},...(body?{body:form?body:JSON.stringify(body)}:{})});
 const result=await r.json();assert.equal(r.status,expected,`${method} ${url}: ${JSON.stringify(result)}`);count++;return result;
}
try{
 await transaction(async c=>{
   for(const [id,name,cnpj] of [[ids.a,'TESTE ISOLADO A','00000000000191'],[ids.b,'TESTE ISOLADO B','00000000000272']])await c.query('INSERT INTO loja(id,nome,cnpj,representante,telefone) VALUES($1,$2,$3,\'Teste automatizado\',\'11999999999\')',[id,name,cnpj]);
   for(const [key,id,loja,role] of [['a',ids.ua,ids.a,'LOJA'],['b',ids.ub,ids.b,'LOJA'],['admin',ids.admin,null,'ADMIN']]){
     await c.query("INSERT INTO usuario(id,loja_id,nome,email,perfil,status) VALUES($1,$2,'Teste automatizado',$3,$4,'ATIVO')",[id,loja,`test-${id}@example.invalid`,role]);
     await c.query("INSERT INTO sessao(token_hash,usuario_id,expira_em) VALUES($1,$2,now()+interval '10 minutes')",[hash(tokens[key]),id]);
   }
 });
 await request('/auth/me');
 const resetToken=crypto.randomBytes(32).toString('hex');
 await pool.query("INSERT INTO token_senha(token_hash,usuario_id,finalidade,expira_em) VALUES($1,$2,'RECUPERACAO',now()+interval '10 minutes')",[hash(resetToken),ids.ub]);
 await request('/auth/reset','POST',{token:resetToken,password:'Temporary-test-only-79314'},'b');
 await request('/auth/reset','POST',{token:resetToken,password:'Temporary-test-only-79314'},'b',400);
 await request('/auth/me','GET',null,'b',401);
 const login=await fetch(base+'/auth/login',{method:'POST',headers:{'X-GMV-Request':'1','Content-Type':'application/json'},body:JSON.stringify({email:`test-${ids.ub}@example.invalid`,password:'Temporary-test-only-79314'})});
 assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly/i);count++;
 tokens.b=login.headers.get('set-cookie').split(';')[0].slice(12);
 await request('/auth/me','GET',null,'b');
 await request('/admin/users','GET',null,'a',403);
 let s=await request('/simulations','POST',{loja_id:ids.b},'a',201);assert.equal(s.loja_id,ids.a);
 await request('/simulations/'+s.id,'GET',null,'b',404);
 s=await request('/simulations/'+s.id,'PATCH',{versao:s.versao,placa:'ABC1D23',cpf:'52998224725',valor_financiado:null,parcelas:48,valor_fipe:50000,cliente:{score:1000},status:'APROVADA'});
 assert.equal(s.valor_fipe,null);assert.equal(s.status,'SIMULACAO');assert.deepEqual(s.cliente,{});
 await request('/simulations/'+s.id,'PATCH',{versao:1,placa:s.placa,cpf:s.cpf,valor_financiado:null,parcelas:48},'a',409);
 await request('/simulations/'+s.id,'PATCH',{versao:s.versao,placa:s.placa,cpf:s.cpf,valor_financiado:10000,parcelas:48},'a',400);
 if(process.env.TEST_PLACA_FIPE_FIXTURE==='true'){
   await request('/simulations/'+s.id+'/consult','POST',{},'b',404);
   s=await request('/simulations/'+s.id+'/consult','POST');
   assert.equal(s.consulta_veiculo_status,'SELECAO_PENDENTE');assert.equal(s.valor_fipe,null);
   assert.equal(s.consulta_cliente_status,'PENDENTE');assert.equal(s.veiculo.opcoes_fipe.length,2);
   const repeated=await request('/simulations/'+s.id+'/consult','POST');assert.equal(repeated.versao,s.versao);
   await request('/simulations/'+s.id+'/vehicle-selection','POST',{index:99,versao:s.versao},'a',400);
   await request('/simulations/'+s.id+'/vehicle-selection','POST',{index:1,versao:s.versao-1},'a',409);
   s=await request('/simulations/'+s.id+'/vehicle-selection','POST',{index:1,versao:s.versao,valor_fipe:1});
   assert.equal(Number(s.valor_fipe),55000);assert.equal(s.veiculo.modelo,'MODELO B');assert.equal(s.consulta_veiculo_status,'CONCLUIDA');
   s=await request('/simulations/'+s.id,'PATCH',{versao:s.versao,placa:'XYZ9A99',cpf:s.cpf,valor_financiado:null,parcelas:48});
   assert.equal(s.valor_fipe,null);assert.deepEqual(s.veiculo,{});assert.equal(s.consulta_veiculo_status,'PENDENTE');
 }else{
   // Execute sem token para verificar o bloqueio de configuração, sem consumir consultas reais.
   await request('/simulations/'+s.id+'/consult','POST',{},'a',503);
   s=await request('/simulations/'+s.id);
 }
 await request('/simulations/'+s.id+'/submit','POST',{parametros_versao:s.parametros.versao},'a',400);
 // Simula apenas dentro do teste uma resposta homologada de fornecedor; não há endpoint de injeção no aplicativo.
 await pool.query("UPDATE simulacao SET veiculo=$1,cliente=$2,valor_fipe=50000,consulta_veiculo_status='CONCLUIDA',consulta_cliente_status='CONCLUIDA' WHERE id=$3",[{marca:'TESTE',modelo:'Veículo de teste',ano_modelo:2020,tipo:'carro',referencia:'2026-10'},{nome:'Pessoa de teste',score:600,pendencias_resumo:'Sem dados reais'},s.id]);
 for(const amount of [4999.99,40000.01,0,10000.001]) {
   await request('/simulations/'+s.id,'PATCH',{versao:s.versao,placa:s.placa,cpf:s.cpf,valor_financiado:amount,percentual:50,parcelas:48},'a',400);
 }
 s=await request('/simulations/'+s.id,'PATCH',{versao:s.versao,placa:s.placa,cpf:s.cpf,valor_financiado:12345.67,percentual:80,parcelas:48});
 assert.equal(Number(s.valor_financiado),12345.67);assert.equal(Number(s.percentual),24.69);
 const reloaded=await request('/simulations/'+s.id);assert.equal(Number(reloaded.valor_financiado),12345.67);
 s=await request('/simulations/'+s.id,'PATCH',{versao:s.versao,placa:s.placa,cpf:s.cpf,valor_financiado:40000,parcelas:48});assert.equal(Number(s.valor_parcela),1304.07);assert.equal(Number(s.percentual),80);
 const p=await request('/simulations/'+s.id+'/submit','POST',{parametros_versao:s.parametros.versao});
 const repeated=await request('/simulations/'+s.id+'/submit','POST',{parametros_versao:s.parametros.versao});assert.equal(repeated.id,p.id);
 await request('/simulations/'+s.id,'PATCH',{versao:s.versao+1,placa:s.placa,cpf:s.cpf,valor_financiado:25000,parcelas:12},'a',409);
 await request('/admin/proposals/'+p.id+'/decision','POST',{decision:'APROVADA'},'a',403);
 await request('/proposals/'+p.id+'/documents','GET',null,'b',404);
 const premature=new FormData();premature.append('tipo','CNH');premature.append('file',new Blob(['%PDF-1.4\nTESTE'],{type:'application/pdf'}),'teste.pdf');
 await request('/proposals/'+p.id+'/documents','POST',premature,'a',409);
 await request('/admin/proposals/'+p.id+'/decision','POST',{decision:'APROVADA',motivo:'Validação automatizada temporária'},'admin');
 await request('/admin/proposals/'+p.id+'/decision','POST',{decision:'APROVADA'},'admin',409);
 const file=new FormData();file.append('tipo','CNH');file.append('file',new Blob(['%PDF-1.4\nTESTE'],{type:'application/pdf'}),'teste.pdf');
 await request('/proposals/'+p.id+'/documents','POST',file,'a',201);
 const docs=await request('/proposals/'+p.id+'/documents');assert.equal(docs[0].status,'AGUARDANDO_INTEGRACAO');
 await request('/proposals/'+p.id+'/contract','POST',{},'a',409);
 const report=await request('/admin/reports?loja='+ids.a,'GET',null,'admin');assert.equal(Number(report.rows[0].principal),40000);assert.equal(Number(report.rows[0].retorno),62595.36);
 await request('/admin/users/'+ids.ua+'/action','POST',{action:'disable'},'admin');
 await request('/auth/me','GET',null,'a',401);
 const check=await fetch(base+'/auth/logout',{method:'POST',headers:{Origin:'https://foreign.invalid','X-GMV-Request':'1'}});assert.equal(check.status,403);count++;
 console.log(`${count} verificações de integração concluídas: isolamento, cálculo, concorrência, proposta, documentos e revogação.`);
}finally{
 const {rows:files}=await pool.query('SELECT arquivo FROM documento WHERE enviado_por=ANY($1::uuid[])',[[ids.ua,ids.ub,ids.admin]]);
 await transaction(async c=>{
   await c.query('DELETE FROM documento WHERE enviado_por=ANY($1::uuid[])',[[ids.ua,ids.ub,ids.admin]]);
   await c.query('DELETE FROM proposta WHERE loja_id=ANY($1::uuid[])',[[ids.a,ids.b]]);
   await c.query('DELETE FROM simulacao WHERE loja_id=ANY($1::uuid[])',[[ids.a,ids.b]]);
   await c.query('DELETE FROM auditoria WHERE usuario_id=ANY($1::uuid[])',[[ids.ua,ids.ub,ids.admin]]);
   await c.query('DELETE FROM usuario WHERE id=ANY($1::uuid[])',[[ids.ua,ids.ub,ids.admin]]);
   await c.query('DELETE FROM loja WHERE id=ANY($1::uuid[])',[[ids.a,ids.b]]);
 });
 for(const f of files)await unlink(path.resolve('private/documents',f.arquivo));
 await pool.end();
}
