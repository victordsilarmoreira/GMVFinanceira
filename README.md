# GMVFinanceira

Primeira versão em Node.js/Express, React/Vite e PostgreSQL. Node.js 22 ou superior.

## Executar

1. `npm install`
2. Copiar `.env.example` para `.env` e preencher as configurações locais. Não versionar credenciais.
3. `npm run db:migrate`
4. `npm run admin:invite -- administrador@dominio.com`
5. `npm run dev`

Interface: http://localhost:5173. Servidor: http://127.0.0.1:3100.

Produção: `npm run build` e `npm start`; configurar `APP_URL` com a origem HTTPS real e `NODE_ENV=production`. Configurar proxy HTTPS para o servidor local. Para contêineres, ajustar o endereço de bind conforme a infraestrutura. Os arquivos em `private/documents` exigem volume persistente e backup ou migração para Blob Storage privado antes da publicação. `.env` e arquivos privados não devem ser publicados.

## Incluído

- Solicitação de acesso com loja, CNPJ, representante, telefone e e-mail.
- Aprovação administrativa, convite temporário, login com cookie HttpOnly, recuperação e troca de senha; senhas com bcrypt e tokens armazenados por hash.
- Bloqueio de acesso por status e isolamento de dados por loja no servidor.
- Simulações com salvamento automático, versão para conflitos entre sessões e cálculo Price no servidor. O usuário informa o valor financiado em reais; o percentual da FIPE é calculado automaticamente e validado contra os limites, inclusive no envio da proposta. O valor digitado é preservado em centavos, sem ser reconstruído a partir do percentual arredondado. O campo depende de uma FIPE consultada; trocar a placa limpa os valores anteriores.
- Taxa mensal única, limites de percentual/prazo e ano-modelo mínimo opcional.
- Snapshot e envio transacional da proposta, aprovação/reprovação e auditoria.
- Recepção privada de CNH/CRLV para propostas aprovadas, validação básica do formato e acesso autenticado.
- Relatórios de principal aprovado, retorno e juros previstos por loja, mês e tipo de veículo.

As tabelas ficam no schema `gmvfinanceira`; os objetos de outros schemas não são alterados. A migração é transacional e pode ser reexecutada para verificar a criação inicial. Evoluções posteriores exigem migrações versionadas.

## Integração de placa/FIPE

Configure `PLACA_FIPE_TOKEN` no `.env` e reinicie o servidor. O token é utilizado somente no servidor, em POST HTTPS para `https://api.placafipe.com.br/getplacafipe`, conforme a documentação https://doc.placafipe.com.br/api/getplacafipe.html. Nunca inclua o token real no `.env.example`.

O botão **Consultar placa/FIPE** consulta a placa salva, sem exigir CPF. Uma resposta com um modelo preenche a FIPE; com vários modelos, o usuário deve selecionar uma das opções devolvidas pelo fornecedor. A escolha envia apenas o índice e a versão da simulação; o servidor obtém o valor da resposta persistida. A consulta registra fornecedor, horário, versão do conector e referência FIPE, sem armazenar o payload bruto. Falhas e escolhas são auditadas. Combustível divergente, dados inconsistentes ou FIPE ausente não liberam o cálculo.

Consultas concluídas e opções pendentes são reutilizadas na mesma simulação para evitar consumo duplicado de quotas. Alterar a placa invalida veículo, opções e valores. A integração usa timeout de 20 segundos, sem tentativas automáticas. A seleção do modelo zera o financiamento anterior para recalcular as condições. Nenhuma consulta de crédito é concluída por esta integração.

## Integrações pendentes — bloqueios intencionais

Crédito, OCR e assinatura ainda não estão integrados. Não existem dados de crédito fictícios nem fallback que aprove uma operação. A simulação permite salvar os dados e as condições, mas não calcula valores sem FIPE obtida pela integração. Envio para análise exige consultas de veículo e crédito concluídas no servidor. OCR pendente bloqueia a geração do contrato. O fluxo de propostas foi implementado e testado com dados sintéticos isolados, sem liberar esses dados para a operação.

Próximos conectores sugeridos: Serasa, idwall e Clicksign. Cada conector deve validar resposta, registrar horário/versão e tratar indisponibilidade sem representar ausência de pendências. Não há endpoint de edição manual de score ou valor FIPE.

E-mail: SMTP STARTTLS porta 587. Suporte a senha ou access token OAuth2 via `SMTP_ACCESS_TOKEN`; renovação automática OAuth ainda deve ser integrada antes de usar esse modo continuamente. Falhas de convite ficam registradas e permitem reenvio pelo administrador. O envio imediato desta versão precisa evoluir para fila persistente com tentativas em implantação de maior volume.

## Regras iniciais

Os valores 2% ao mês, 10–80% da FIPE, 6–48 parcelas e ano-modelo 2010 são parâmetros iniciais sugeridos, não condições comerciais homologadas. Devem ser revisados pelo administrador. Propostas não podem ser editadas após envio. Nesta versão, uma simulação gera uma proposta; revisões exigem nova simulação. Alterações dos parâmetros atualizam taxa, limites e cálculo das simulações em edição. Valores e prazos fora das novas regras são preservados para correção, com a parcela indisponível até o ajuste. Abrir ou recarregar a simulação também sincroniza parâmetros antigos. Propostas enviadas mantêm suas condições originais.

Cadastro público: um usuário inicial por CNPJ; a administração de múltiplos usuários da mesma loja fica para evolução. Administradores são convidados por comando local, nunca por promoção pública. Desabilitar um usuário invalida suas sessões e tokens.

Os relatórios são projeções sobre propostas aprovadas, não patrimônio efetivamente desembolsado ou lucro líquido. Falta integrar desembolsos, pagamentos e custos para indicadores realizados. A visão geral lista até 100 operações recentes; relatórios agregam todos os registros elegíveis.

## Verificação

`npm test` valida cálculo financeiro, documentos e regras de entrada. `npm run build` valida a compilação da interface. `node tests/integration.js` valida permissões, concorrência, transições e documentos com registros sintéticos temporários em banco configurado e servidor local ativo. Esse teste limpa os próprios registros ao terminar e não envia e-mail.

Antes de publicar: contratar e homologar conectores, revisar modelo contratual e regras documentais, definir operação de crédito próprio ou intermediado, homologar parâmetros, configurar armazenamento persistente, proteção de dados e monitoramento. Nenhuma publicação é feita pelos comandos de desenvolvimento.
