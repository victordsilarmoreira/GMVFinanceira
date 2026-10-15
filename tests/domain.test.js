import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculate,validCPF,validCNPJ,validateTerms,configSchema,editSchema} from '../server/domain.js';
test('Tabela Price: principal de 40 mil, 2% ao mês, 48 meses',()=>{
 const r=calculate(50000,80,48,2);
 assert.equal(r.valor_financiado,40000);assert.equal(r.valor_parcela,1304.07);
});
test('taxa zero divide o principal e arredonda centavos',()=>{
 assert.deepEqual(calculate(30000,50,12,0),{valor_financiado:15000,valor_parcela:1250});
 assert.equal(calculate(10000,100,3,0).valor_parcela,3333.33);
});
test('validadores rejeitam documentos repetidos e dígitos incorretos',()=>{
 assert.equal(validCPF('529.982.247-25'),true);assert.equal(validCPF('52998224724'),false);assert.equal(validCPF('11111111111'),false);
 assert.equal(validCNPJ('11.222.333/0001-81'),true);assert.equal(validCNPJ('11222333000182'),false);assert.equal(validCNPJ('00000000000000'),false);
});
test('limites e idade são aplicados no servidor',()=>{
 const p={percentual_min:10,percentual_max:80,parcelas_min:6,parcelas_max:48,verificar_ano:true,ano_min:2010};
 assert.doesNotThrow(()=>validateTerms(p,80,48,2010));
 for(const args of [[81,48,2020],[9,48,2020],[80,49,2020],[80,5,2020],[80,12.5,2020],[80,48,2009]])assert.throws(()=>validateTerms(p,...args));
 assert.doesNotThrow(()=>validateTerms({...p,verificar_ano:false},80,48,2009));
});
test('configuração rejeita faixas invertidas',()=>{
 const p={taxa_mensal:2,percentual_min:80,percentual_max:10,parcelas_min:6,parcelas_max:48,verificar_ano:false,ano_min:2010};
 assert.equal(configSchema.safeParse(p).success,false);
});
test('edição não permite injetar score, FIPE, estado ou loja',()=>{
 const d=editSchema.parse({versao:1,placa:'abc-1d23',cpf:'529.982.247-25',percentual:80,valor_financiado:40000,parcelas:48,cliente:{score:1000},valor_fipe:999999,status:'APROVADA',loja_id:'x'});
 assert.equal(d.placa,'ABC1D23');assert.equal(d.cpf,'52998224725');
 for(const key of ['cliente','valor_fipe','status','loja_id','percentual'])assert.equal(key in d,false);
});
