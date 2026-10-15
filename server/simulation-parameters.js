import { financingFromAmount } from '../src/financing.js';
import { validateTerms } from './domain.js';

const fields = ['versao','taxa_mensal','percentual_min','percentual_max','parcelas_min','parcelas_max','verificar_ano','ano_min'];
export function parametersMatch(a, b) {
  return fields.every(key => String(a?.[key]) === String(b?.[key]));
}

export function applyParameters(simulation, parameters) {
  if (simulation.status !== 'SIMULACAO') return simulation;
  const updated = { ...simulation, parametros: parameters, taxa_mensal: parameters.taxa_mensal, valor_parcela: null, erro_parametros: null };
  try {
    let percent = Number(parameters.percentual_min);
    if (simulation.valor_financiado != null) {
      const terms = financingFromAmount(simulation.valor_fipe, Number(simulation.valor_financiado), simulation.parcelas, Number(parameters.taxa_mensal), parameters);
      Object.assign(updated, terms);
      percent = terms.percentual;
    }
    validateTerms(parameters, percent, simulation.parcelas, simulation.veiculo?.ano_modelo);
  } catch (e) {
    updated.valor_parcela = null;
    updated.erro_parametros = e.message;
  }
  return updated;
}

// Caller holds the simulation row lock. Submitted proposals keep their snapshot.
export async function refreshDraft(client, simulation, parameters) {
  const updated = applyParameters(simulation, parameters);
  if (simulation.status !== 'SIMULACAO' || parametersMatch(simulation.parametros, parameters)) return updated;
  const { rows: [saved] } = await client.query(`UPDATE simulacao
    SET parametros=$1,taxa_mensal=$2,valor_parcela=$3,percentual=$4,
        versao=versao+1,atualizada_em=now() WHERE id=$5 AND status='SIMULACAO' RETURNING *`,
    [parameters, parameters.taxa_mensal, updated.valor_parcela, updated.percentual, simulation.id]);
  return { ...simulation, ...saved, erro_parametros: updated.erro_parametros };
}

export async function refreshAllDrafts(client, parameters) {
  const { rows } = await client.query("SELECT * FROM simulacao WHERE status='SIMULACAO' ORDER BY id FOR UPDATE");
  for (const row of rows) await refreshDraft(client, row, parameters);
}
