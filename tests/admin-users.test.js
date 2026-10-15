import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adminUserSchema} from '../server/domain.js';
const base={nome:'Usuário Teste',email:'TESTE@example.invalid'};
const loja_id='e2acbde4-3425-43eb-9ccd-1b2748ad1268';
const nova_loja={nome:'Loja Teste',cnpj:'11.222.333/0001-81',representante:'Representante Teste',telefone:'(11) 99999-9999'};
test('administrativo sem vínculo e e-mail normalizado',()=>{
 assert.deepEqual(adminUserSchema.parse({...base,perfil:'ADMIN'}),{...base,email:'teste@example.invalid',perfil:'ADMIN'});
 assert.equal(adminUserSchema.safeParse({...base,perfil:'ADMIN',loja_id}).success,false);
});
test('perfil loja exige exatamente uma loja existente ou nova',()=>{
 assert.equal(adminUserSchema.safeParse({...base,perfil:'LOJA'}).success,false);
 assert.equal(adminUserSchema.safeParse({...base,perfil:'LOJA',loja_id,nova_loja}).success,false);
 assert.equal(adminUserSchema.parse({...base,perfil:'LOJA',loja_id}).loja_id,loja_id);
 const data=adminUserSchema.parse({...base,perfil:'LOJA',nova_loja});
 assert.equal(data.nova_loja.cnpj,'11222333000181');assert.equal(data.nova_loja.telefone,'11999999999');
});
test('cadastro rejeita documento inválido, perfil desconhecido e campos de acesso injetados',()=>{
 for(const payload of [
 {...base,perfil:'ROOT'}, {...base,perfil:'LOJA',loja_id:'invalido'},
 {...base,perfil:'LOJA',nova_loja:{...nova_loja,cnpj:'11111111111111'}},
 {...base,perfil:'LOJA',nova_loja:{...nova_loja,telefone:'123'}},
 {...base,perfil:'ADMIN',status:'ATIVO'}, {...base,perfil:'ADMIN',senha_hash:'injetada'},
 {...base,perfil:'ADMIN',email:'invalido'}, {...base,perfil:'ADMIN',nome:' '}
 ])assert.equal(adminUserSchema.safeParse(payload).success,false);
});
