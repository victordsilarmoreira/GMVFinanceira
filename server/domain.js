import { z } from 'zod';
export const digits = value => String(value || '').replace(/\D/g, '');
export function validCPF(value) {
  const n = digits(value);
  if (n.length !== 11 || /^(\d)\1+$/.test(n)) return false;
  return [9,10].every(len => {
    let sum = 0; for (let i=0;i<len;i++) sum += Number(n[i]) * (len+1-i);
    const digit = (sum*10)%11; return Number(n[len]) === (digit===10?0:digit);
  });
}
export function validCNPJ(value) {
  const n = digits(value); if(n.length!==14 || /^(\d)\1+$/.test(n)) return false;
  return [12,13].every(len => { let sum=0, weight=len-7; for(let i=0;i<len;i++){sum+=Number(n[i])*weight; weight=weight===2?9:weight-1;} const r=sum%11; return Number(n[len])===(r<2?0:11-r); });
}
export const registerSchema = z.object({
  loja: z.string().trim().min(2).max(150), cnpj: z.string().transform(digits).refine(validCNPJ, 'CNPJ inválido'),
  nome: z.string().trim().min(3).max(150), telefone: z.string().transform(digits).refine(v=>/^\d{10,13}$/.test(v),'Telefone inválido'),
  email: z.email().max(200).transform(v=>v.toLowerCase()), aceite: z.literal(true)
});
export const configSchema = z.object({
  taxa_mensal: z.number().min(0).max(100), percentual_min: z.number().gt(0).max(100), percentual_max: z.number().gt(0).max(100),
  parcelas_min: z.number().int().min(1).max(360), parcelas_max: z.number().int().min(1).max(360),
  verificar_ano: z.boolean(), ano_min: z.number().int().min(1900).max(new Date().getFullYear()+1)
}).refine(v=>v.percentual_min<=v.percentual_max && v.parcelas_min<=v.parcelas_max,'Limites mínimos não podem superar os máximos');
export const editSchema = z.object({
  versao:z.number().int().positive(), placa:z.string().max(10).transform(v=>v.replace(/[^a-z0-9]/gi,'').toUpperCase()),
  cpf:z.string().max(14).transform(digits), valor_financiado:z.number().finite().nonnegative().max(1e9).nullable(), parcelas:z.number().int()
});
export function calculate(fipe, percent, installments, rate) {
  const principal = Math.round(Number(fipe)*percent)/100;
  const i = rate/100;
  const payment = i === 0 ? principal/installments : principal*i/(-Math.expm1(-installments*Math.log1p(i)));
  return { valor_financiado:principal, valor_parcela:Math.round(payment*100)/100 };
}
export function validateTerms(p, percent, installments, year) {
  if(percent < Number(p.percentual_min) || percent > Number(p.percentual_max)) throw new Error('Percentual fora dos limites configurados.');
  if(!Number.isInteger(installments) || installments < p.parcelas_min || installments > p.parcelas_max) throw new Error('Quantidade de parcelas fora dos limites configurados.');
  if(year && p.verificar_ano && year < p.ano_min) throw new Error('Ano-modelo abaixo do mínimo permitido.');
}

export const adminUserSchema = z.discriminatedUnion('perfil', [
 z.object({perfil:z.literal('ADMIN'),nome:registerSchema.shape.nome,email:registerSchema.shape.email}).strict(),
 z.object({perfil:z.literal('LOJA'),nome:registerSchema.shape.nome,email:registerSchema.shape.email,loja_id:z.uuid().optional(),nova_loja:z.object({nome:registerSchema.shape.loja,cnpj:registerSchema.shape.cnpj,representante:registerSchema.shape.nome,telefone:registerSchema.shape.telefone}).strict().optional()}).strict()
]).refine(d=>d.perfil==='ADMIN'||Boolean(d.loja_id)!==Boolean(d.nova_loja),'Selecione uma loja existente ou cadastre uma nova loja.');
