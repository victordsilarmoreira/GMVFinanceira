import test from 'node:test';
import assert from 'node:assert/strict';
import {consultVehicle,normalizeVehicle,selectVehicleOption} from '../server/placa-fipe.js';

const fixture=()=>({codigo:1,placa:'ABC1D23',informacoes_veiculo:{placa:'ABC1D23',marca:'TESTE',modelo:'Modelo teste',ano_modelo:'2020',segmento:'AUTO'},fipe:[{marca:'TESTE',modelo:'Modelo teste',ano_modelo:2020,codigo_fipe:'001001-1',mes_referencia:'outubro de 2026',valor:'50000.00',unidade_valor:'R$',combustivel:'GASOLINA'}]});
test('normaliza dados do fornecedor e preserva a escolha entre modelos',()=>{
 const data=fixture();data.fipe.push({...data.fipe[0],modelo:'Outra versão',codigo_fipe:'001002-2',valor:'55000.00'});
 const result=normalizeVehicle(data,'ABC1D23');
 assert.equal(result.valor_fipe,undefined);assert.equal(result.tipo,'carro');assert.equal(result.opcoes_fipe.length,2);
 assert.equal(selectVehicleOption(result,1).valor_fipe,55000);
 assert.throws(()=>selectVehicleOption(result,2),{status:400});
});
test('rejeita dados incompletos, valores inválidos e placas divergentes',()=>{
 for(const change of [d=>d.placa='XYZ9A99',d=>d.informacoes_veiculo.placa='XYZ9A99',d=>d.fipe[0].valor='50.000,00',d=>d.fipe[0].valor='-1',d=>d.fipe[0].ano_modelo=2019,d=>d.fipe[0].codigo_fipe='',d=>d.informacoes_veiculo.ano_modelo='0']){
  const data=fixture();change(data);assert.throws(()=>normalizeVehicle(data,'ABC1D23'),{status:502});
 }
});
test('não aceita combustível divergente, falta de FIPE ou limite do plano',()=>{
 for(const [codigo,status] of [[22,422],[312,422],[4862,503],[9,502]])assert.throws(()=>normalizeVehicle({...fixture(),codigo},'ABC1D23'),{status});
 assert.throws(()=>normalizeVehicle({...fixture(),fipe:[]},'ABC1D23'),{status:422});
});
test('usa POST com token somente no corpo, limite de tempo e sem redirecionar',async()=>{
 let calls=0;
 const result=await consultVehicle('ABC1D23',{token:' secret ',fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,'https://api.placafipe.com.br/getplacafipe');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.ok(options.signal);assert.deepEqual(JSON.parse(options.body),{placa:'ABC1D23',token:'secret'});
  return {ok:true,json:async()=>fixture()};
 }});
 assert.equal(calls,1);assert.equal(selectVehicleOption(result,0).valor_fipe,50000);assert.ok(!JSON.stringify(result).includes('secret'));
});
test('configuração e placa inválida não chamam o fornecedor',async()=>{
 const fetchImpl=()=>assert.fail('não deve consultar');
 await assert.rejects(consultVehicle('ABC1D23',{token:'',fetchImpl}),{status:503});
 await assert.rejects(consultVehicle('INVALID',{token:'secret',fetchImpl}),{status:400});
});
test('falhas externas são sanitizadas e não há retry automático',async()=>{
 let calls=0;
 for(const [fetchImpl,status] of [[async()=>{calls++;throw new Error('secret');},502],[async()=>{calls++;throw Object.assign(new Error('secret'),{name:'TimeoutError'});},504],[async()=>{calls++;return {ok:false,status:429};},503],[async()=>{calls++;return {ok:true,json:async()=>{throw new Error('secret');}};},502]]){
  await assert.rejects(consultVehicle('ABC1D23',{token:'secret',fetchImpl}),e=>e.status===status&&!e.message.includes('secret'));
 }
 assert.equal(calls,4);
});
