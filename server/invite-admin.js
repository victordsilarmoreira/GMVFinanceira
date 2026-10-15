import crypto from 'node:crypto';
import { z } from 'zod';
import { pool } from './db.js';
import { sendPasswordLink } from './mail.js';
const email = process.argv[2]?.trim().toLowerCase();
try {
  if(!z.email().safeParse(email).success) throw new Error('Informe um e-mail válido: npm run admin:invite -- email@dominio.com');
  let {rows:[user]} = await pool.query('SELECT * FROM usuario WHERE email=$1',[email]);
  if(user && user.perfil!=='ADMIN') throw new Error('Este endereço pertence a um usuário de loja. Promoção automática não permitida.');
  if(user?.status==='ATIVO') throw new Error('Este administrador já está ativo. Use recuperação de senha.');
  if(!user) ({rows:[user]}=await pool.query("INSERT INTO usuario(id,nome,email,perfil,status) VALUES($1,'Administrador',$2,'ADMIN','CONVIDADO') RETURNING *",[crypto.randomUUID(),email]));
  await sendPasswordLink(user,'CONVITE');
  console.log('Convite de administrador enviado.');
} catch(e) { console.error(e.message); process.exitCode=1; }
finally { await pool.end(); }
