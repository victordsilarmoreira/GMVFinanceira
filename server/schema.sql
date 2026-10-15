CREATE SCHEMA IF NOT EXISTS gmvfinanceira;
SET search_path TO gmvfinanceira, public;
CREATE TABLE IF NOT EXISTS loja (
 id uuid PRIMARY KEY, nome text NOT NULL, cnpj varchar(14) NOT NULL UNIQUE,
 representante text NOT NULL, telefone varchar(13) NOT NULL, criada_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS usuario (
 id uuid PRIMARY KEY, loja_id uuid REFERENCES loja(id), nome text NOT NULL,
 email text NOT NULL UNIQUE, senha_hash text,
 perfil text NOT NULL DEFAULT 'LOJA' CHECK (perfil IN ('LOJA','ADMIN')),
 status text NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','CONVIDADO','ATIVO','DESABILITADO','REJEITADO')),
 aprovado_por uuid REFERENCES usuario(id), criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessao (
 token_hash text PRIMARY KEY, usuario_id uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
 expira_em timestamptz NOT NULL, criada_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS token_senha (
 token_hash text PRIMARY KEY, usuario_id uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
 finalidade text NOT NULL CHECK (finalidade IN ('CONVITE','RECUPERACAO')),
 expira_em timestamptz NOT NULL, usado_em timestamptz
);
CREATE TABLE IF NOT EXISTS parametro_financiamento (
 id integer PRIMARY KEY CHECK (id=1), versao integer NOT NULL DEFAULT 1,
 taxa_mensal numeric(10,4) NOT NULL DEFAULT 2,
 percentual_min numeric(8,2) NOT NULL DEFAULT 10, percentual_max numeric(8,2) NOT NULL DEFAULT 80,
 parcelas_min integer NOT NULL DEFAULT 6, parcelas_max integer NOT NULL DEFAULT 48,
 verificar_ano boolean NOT NULL DEFAULT true, ano_min integer NOT NULL DEFAULT 2010,
 atualizado_em timestamptz NOT NULL DEFAULT now(), atualizado_por uuid REFERENCES usuario(id),
 CHECK (taxa_mensal >= 0 AND percentual_min > 0 AND percentual_max >= percentual_min AND percentual_max <= 100),
 CHECK (parcelas_min > 0 AND parcelas_max >= parcelas_min)
);
INSERT INTO parametro_financiamento(id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS simulacao (
 id uuid PRIMARY KEY, loja_id uuid NOT NULL REFERENCES loja(id), usuario_id uuid NOT NULL REFERENCES usuario(id),
 placa text NOT NULL DEFAULT '', cpf text NOT NULL DEFAULT '',
 veiculo jsonb NOT NULL DEFAULT '{}', cliente jsonb NOT NULL DEFAULT '{}',
 consulta_veiculo_status text NOT NULL DEFAULT 'PENDENTE', consulta_cliente_status text NOT NULL DEFAULT 'PENDENTE',
 percentual numeric(8,2) NOT NULL, parcelas integer NOT NULL,
 valor_fipe numeric(14,2), valor_financiado numeric(14,2), valor_parcela numeric(14,2),
 taxa_mensal numeric(10,4) NOT NULL, parametros jsonb NOT NULL,
 status text NOT NULL DEFAULT 'SIMULACAO', versao integer NOT NULL DEFAULT 1,
 criada_em timestamptz NOT NULL DEFAULT now(), atualizada_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS proposta (
 id uuid PRIMARY KEY, simulacao_id uuid NOT NULL UNIQUE REFERENCES simulacao(id),
 loja_id uuid NOT NULL REFERENCES loja(id), dados jsonb NOT NULL,
 status text NOT NULL DEFAULT 'EM_ANALISE' CHECK(status IN ('EM_ANALISE','APROVADA','REPROVADA')),
 motivo text, analisada_por uuid REFERENCES usuario(id), analisada_em timestamptz,
 criada_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS documento (
 id uuid PRIMARY KEY, proposta_id uuid NOT NULL REFERENCES proposta(id),
 tipo text NOT NULL CHECK (tipo IN ('CNH','CRLV')), nome_original text NOT NULL,
 arquivo text NOT NULL, mime text NOT NULL, tamanho integer NOT NULL, sha256 text NOT NULL,
 status text NOT NULL DEFAULT 'AGUARDANDO_INTEGRACAO', enviado_por uuid NOT NULL REFERENCES usuario(id),
 criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auditoria (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, usuario_id uuid REFERENCES usuario(id),
 acao text NOT NULL, entidade_id text, detalhes jsonb NOT NULL DEFAULT '{}', criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS email_evento (
 id uuid PRIMARY KEY, usuario_id uuid REFERENCES usuario(id), tipo text NOT NULL,
 status text NOT NULL, criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS simulacao_loja_data ON simulacao(loja_id, criada_em DESC);
CREATE INDEX IF NOT EXISTS proposta_loja_data ON proposta(loja_id, criada_em DESC);
CREATE INDEX IF NOT EXISTS sessao_usuario ON sessao(usuario_id);
