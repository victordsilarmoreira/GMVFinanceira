import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { pool, transaction } from './db.js';
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export async function sendPasswordLink(user, purpose) {
  if(!process.env.SMTP_USER || (!process.env.SMTP_PASS && !process.env.SMTP_ACCESS_TOKEN)) throw Object.assign(new Error('Envio de e-mail ainda não configurado.'),{status:503});
  const token = crypto.randomBytes(32).toString('hex');
  await transaction(async c => {
    await c.query('DELETE FROM token_senha WHERE usuario_id=$1 AND usado_em IS NULL', [user.id]);
    await c.query("INSERT INTO token_senha(token_hash,usuario_id,finalidade,expira_em) VALUES($1,$2,$3,now()+interval '1 hour')",[hash(token),user.id,purpose]);
  });
  const url = new URL('/?token='+token, process.env.APP_URL || 'http://localhost:5173');
  const transport = nodemailer.createTransport({
    host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==='true',requireTLS:true,
    auth:process.env.SMTP_ACCESS_TOKEN ? {type:'OAuth2',user:process.env.SMTP_USER,accessToken:process.env.SMTP_ACCESS_TOKEN} : {user:process.env.SMTP_USER,pass:process.env.SMTP_PASS},
    connectionTimeout:10000, socketTimeout:15000
  });
  try {
    await transport.sendMail({from:process.env.EMAIL_REMETENTE,to:user.email,subject:purpose==='CONVITE'?'GMVFinanceira — defina sua senha':'GMVFinanceira — recuperação de senha',text:`Acesse o endereço abaixo para definir sua senha no GMVFinanceira. O link é válido por 1 hora e pode ser utilizado uma vez.\n\n${url}\n\nSe você não solicitou este acesso, ignore esta mensagem.`});
    await pool.query("INSERT INTO email_evento(id,usuario_id,tipo,status) VALUES($1,$2,$3,'ENVIADO')",[crypto.randomUUID(),user.id,purpose]);
  } catch {
    await pool.query('DELETE FROM token_senha WHERE token_hash=$1',[hash(token)]);
    await pool.query("INSERT INTO email_evento(id,usuario_id,tipo,status) VALUES($1,$2,$3,'FALHOU')",[crypto.randomUUID(),user.id,purpose]);
    throw Object.assign(new Error('Não foi possível enviar o e-mail. Verifique a configuração do Microsoft 365 e reenvie o convite.'),{status:502});
  }
}
