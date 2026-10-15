import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyParameters, parametersMatch } from '../server/simulation-parameters.js';
const old = {versao:1,taxa_mensal:'2.0000',percentual_min:'10.00',percentual_max:'80.00',parcelas_min:6,parcelas_max:48,verificar_ano:true,ano_min:2010};
const newer = {...old,versao:2,taxa_mensal:'6.0000',percentual_max:'70.00',parcelas_max:36};
const draft = {status:'SIMULACAO',parametros:old,taxa_mensal:old.taxa_mensal,valor_fipe:50000,valor_financiado:30000,percentual:60,parcelas:24,valor_parcela:1586.13,veiculo:{ano_modelo:2020}};
test('rascunho aplica taxa e limites atuais e recalcula sem alterar valor ou prazo',()=>{
 const updated=applyParameters(draft,newer);
 assert.deepEqual(updated.parametros,newer);assert.equal(updated.taxa_mensal,'6.0000');
 assert.equal(updated.valor_financiado,30000);assert.equal(updated.parcelas,24);
 assert.equal(updated.valor_parcela,2390.37);assert.equal(updated.erro_parametros,null);
 assert.equal(draft.taxa_mensal,'2.0000');
});
test('redução dos limites sinaliza o problema sem ajustar silenciosamente a escolha',()=>{
 for(const original of [{...draft,valor_financiado:40000},{...draft,parcelas:48},{...draft,veiculo:{ano_modelo:2008}}]){
  const updated=applyParameters(original,newer);
  assert.equal(updated.valor_financiado,original.valor_financiado);assert.equal(updated.parcelas,original.parcelas);
  assert.equal(updated.valor_parcela,null);assert.ok(updated.erro_parametros);assert.deepEqual(updated.parametros,newer);
 }
});
test('propostas em análise, aprovadas e reprovadas preservam o snapshot',()=>{
 for(const status of ['EM_ANALISE','APROVADA','REPROVADA']){
  const original={...draft,status};assert.equal(applyParameters(original,newer),original);
 }
});
test('mudança direta de campo também é detectada sem incremento da versão',()=>{
 assert.equal(parametersMatch(old,{...old}),true);
 assert.equal(parametersMatch(old,{...old,taxa_mensal:'3.0000'}),false);
 assert.equal(parametersMatch(old,{...old,parcelas_max:36}),false);
});
test('rascunho sem FIPE acompanha limites e taxa, sem parcela inventada',()=>{
 const updated=applyParameters({...draft,valor_fipe:null,valor_financiado:null,percentual:80},newer);
 assert.equal(updated.valor_parcela,null);assert.equal(updated.erro_parametros,null);
 assert.equal(updated.parametros.percentual_max,'70.00');
});
