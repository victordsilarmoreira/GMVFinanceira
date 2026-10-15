import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pool, transaction } from '../server/db.js';
import { hash } from '../server/mail.js';
import { financingFromAmount } from '../src/financing.js';
import { spawn } from 'node:child_process';
const server=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'3110'},stdio:['ignore','pipe','pipe']});
const ready=new Promise((resolve,reject)=>{
 const timeout=setTimeout(()=>reject(new Error('Servidor de teste não iniciou.')),10000);
 server.stdout.on('data',data=>{if(data.toString().includes('disponível')){clearTimeout(timeout);resolve();}});
 server.on('error',e=>{clearTimeout(timeout);reject(e);});
 server.on('exit',code=>{clearTimeout(timeout);reject(new Error('Servidor de teste encerrou: '+code));});
});
const shop=crypto.randomUUID(),user=crypto.randomUUID(),draft=crypto.randomUUID(),submitted=crypto.randomUUID();
const token=crypto.randomBytes(32).toString('hex');
async function get(url){
 const response=await fetch('http://127.0.0.1:3110/api'+url,{headers:{Cookie:'gmv_session='+token}});
 assert.equal(response.status,200);return response.json();
}
try{
 await ready;
 const {rows:[current]}=await pool.query('SELECT * FROM parametro_financiamento WHERE id=1');
 const previous={...current,versao:current.versao-1,taxa_mensal:String(Number(current.taxa_mensal)+1)};
 const amount=50000*(Number(current.percentual_min)+Number(current.percentual_max))/200;
 const expected=financingFromAmount(50000,amount,current.parcelas_min,Number(current.taxa_mensal),current);
 await transaction(async c=>{
  await c.query("INSERT INTO loja(id,nome,cnpj,representante,telefone) VALUES($1,'Teste temporário de parâmetros',$2,'Teste','11999999999')",[shop,crypto.randomInt(1e12,9e12).toString().padStart(14,'0')]);
  await c.query("INSERT INTO usuario(id,loja_id,nome,email,perfil,status) VALUES($1,$2,'Teste',$3,'LOJA','ATIVO')",[user,shop,`${user}@example.invalid`]);
  await c.query("INSERT INTO sessao(token_hash,usuario_id,expira_em) VALUES($1,$2,now()+interval '5 minutes')",[hash(token),user]);
  for(const [id,status] of [[draft,'SIMULACAO'],[submitted,'EM_ANALISE']]){
   await c.query('INSERT INTO simulacao(id,loja_id,usuario_id,percentual,parcelas,taxa_mensal,parametros,status,valor_fipe,valor_financiado,valor_parcela,veiculo) VALUES($1,$2,$3,$4,$5,$6,$7,$8,50000,$9,123,$10)',[id,shop,user,expected.percentual,current.parcelas_min,previous.taxa_mensal,previous,status,amount,{ano_modelo:current.ano_min}]);
  }
 });
 const list=await get('/simulations');
 const active=list.find(s=>s.id===draft),frozen=list.find(s=>s.id===submitted);
 assert.equal(active.parametros.versao,current.versao);assert.equal(Number(active.taxa_mensal),Number(current.taxa_mensal));
 assert.equal(Number(active.valor_parcela),expected.valor_parcela);assert.equal(active.versao,2);
 assert.equal(frozen.parametros.versao,previous.versao);assert.equal(Number(frozen.valor_parcela),123);assert.equal(frozen.versao,1);
 const detail=await get('/simulations/'+draft);assert.equal(detail.versao,2);
 assert.equal(detail.parametros.parcelas_max,current.parcelas_max);
 const {rows:[saved]}=await pool.query('SELECT * FROM simulacao WHERE id=$1',[draft]);
 assert.equal(saved.parametros.versao,current.versao);assert.equal(Number(saved.valor_parcela),expected.valor_parcela);
 console.log('Lista e detalhe do lojista sincronizam e persistem parâmetros atuais; snapshot enviado preservado; reabertura sem incremento desnecessário.');
}finally{
 server.kill();
 await transaction(async c=>{
  await c.query('DELETE FROM simulacao WHERE id=ANY($1::uuid[])',[[draft,submitted]]);
  await c.query('DELETE FROM usuario WHERE id=$1',[user]);await c.query('DELETE FROM loja WHERE id=$1',[shop]);
 });
 await pool.end();
}
