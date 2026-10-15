# Implantação pelo GitHub

Repositório: https://github.com/victordsilarmoreira/GMVFinanceira
Branch: `main`. Workflow: `.github/workflows/deploy-azure.yml`.

## GitHub

Em Settings > Secrets and variables > Actions, cadastrar:

- Variable `AZURE_WEBAPP_NAME`: nome exato do App Service.
- Secret `AZURE_WEBAPP_PUBLISH_PROFILE`: conteúdo completo do perfil de publicação baixado do App Service. Não colocar esse conteúdo no repositório.

O perfil de publicação requer SCM Basic Auth Publishing Credentials habilitado no App Service. Se a organização bloquear esse método, adaptar a autenticação para OIDC.

## Azure App Service

Usar App Service Linux com Node.js 22 LTS, publicação de código e comando de inicialização `npm start`.
Configurar as variáveis de ambiente:

```text
NODE_ENV=production
HOST=0.0.0.0
APP_URL=https://<dominio-real>
DOCUMENTS_DIR=/home/gmvfinanceira/documents
SCM_DO_BUILD_DURING_DEPLOYMENT=false
WEBSITE_RUN_FROM_PACKAGE=0
```

Configurar também `DL_DB_HOST`, `DL_DB_PORT`, `DL_DB_NAME`, `DL_DB_USER`, `DL_DB_PASSWORD`, `PGSSL` e as configurações SMTP/FIPE descritas no `.env.example`. O banco deve aceitar conexões do App Service. Nunca usar o `.env` local como pacote de implantação.

Manter `/home` persistente e configurar backup dos documentos. O workflow empacota apenas código, interface compilada e dependências de produção; não envia `.env`, logs ou documentos privados. O servidor requer `src/financing.js`, por isso `src` também faz parte do pacote.

Antes do primeiro uso, executar `npm run db:migrate` no ambiente de destino configurado e convidar o administrador com `npm run admin:invite -- email@dominio.com`. O workflow não executa migrações automaticamente.

## Executar e verificar

Adicionar os arquivos ao repositório informado na branch `main`. Um push nessa branch inicia a implantação. Também é possível executar Actions > Implantar GMVFinanceira no Azure > Run workflow na branch `main`.

O workflow instala dependências, executa testes, compila a interface e publica o pacote. Após concluir, verificar a página inicial, o login e `https://<dominio-real>/api/health`, que verifica a conexão com o banco. Uma publicação bem-sucedida não substitui essa verificação operacional.

Referência: https://learn.microsoft.com/en-us/azure/app-service/deploy-github-actions
