const endpoint = 'https://api.placafipe.com.br/getplacafipe';
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export const vehicleConfigured = () => Boolean(process.env.PLACA_FIPE_TOKEN?.trim());
const plate = value => String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
const text = value => typeof value === 'string' ? value.trim().slice(0, 250) : '';

export function normalizeVehicle(payload, requestedPlate) {
  const code = Number(payload?.codigo);
  if (code !== 1) {
    if (code === 22) fail(422, 'A FIPE retornou outro combustível. Não foi possível confirmar um valor para este veículo.');
    if ([167,312,499,759,763].includes(code)) fail(422, 'Veículo ou tabela FIPE não encontrado. Confira a placa.');
    if ([3974,4862].includes(code)) fail(503, 'Consulta de veículo indisponível: verifique o token e o limite do plano Placa Fipe.');
    fail(502, 'O fornecedor não concluiu a consulta de veículo. Tente novamente mais tarde.');
  }
  const info = payload.informacoes_veiculo;
  if (!info || plate(payload.placa || info.placa) !== requestedPlate || (info.placa && plate(info.placa) !== requestedPlate)) fail(502, 'O fornecedor retornou uma placa diferente da consultada.');
  const year = Number(info.ano_modelo);
  if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear()+1) fail(502, 'Ano-modelo inválido na resposta do fornecedor.');
  if (!Array.isArray(payload.fipe) || !payload.fipe.length) fail(422, 'Nenhum valor FIPE encontrado para este veículo.');
  const options = payload.fipe.map(item => {
    const raw = String(item.valor ?? '').trim();
    const value = /^\d+(\.\d{1,2})?$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isFinite(value) || value <= 0 || value >= 1e12 || Number(item.ano_modelo) !== year || !text(item.marca) || !text(item.modelo) || !/^\d{6}-\d$/.test(item.codigo_fipe) || !text(item.mes_referencia) || (item.unidade_valor && item.unidade_valor !== 'R$')) fail(502, 'Dados FIPE incompletos ou inconsistentes na resposta do fornecedor.');
    return { marca:text(item.marca), modelo:text(item.modelo), ano_modelo:year, codigo_fipe:item.codigo_fipe, referencia:text(item.mes_referencia), combustivel:text(item.combustivel), valor_fipe:value };
  });
  const segment = text(info.segmento).toUpperCase();
  const tipo = /MOTO/.test(segment) ? 'moto' : /CAMINH|CAMINHÃO|ONIBUS|ÔNIBUS/.test(segment) ? 'caminhao' : /AUTO|UTILIT/.test(segment) ? 'carro' : null;
  return { marca:text(info.marca), modelo:text(info.modelo), ano_modelo:year, tipo, cor:text(info.cor), placa:requestedPlate, fornecedor:'placa_fipe', versao_integracao:1, consultado_em:new Date().toISOString(), algoritmo:text(payload.algoritmo), opcoes_fipe:options };
}

export async function consultVehicle(requestedPlate, { token=process.env.PLACA_FIPE_TOKEN, fetchImpl=fetch } = {}) {
  if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(requestedPlate)) fail(400, 'Informe uma placa válida.');
  if (!token?.trim()) fail(503, 'Configure PLACA_FIPE_TOKEN no servidor para consultar o veículo.');
  let response, payload;
  try {
    response = await fetchImpl(endpoint, { method:'POST', redirect:'error', headers:{'Content-Type':'application/json'}, body:JSON.stringify({placa:requestedPlate,token:token.trim()}), signal:AbortSignal.timeout(20000) });
    if (response.ok) payload = await response.json();
  } catch (error) {
    if (['TimeoutError','AbortError'].includes(error.name)) fail(504, 'A consulta do veículo excedeu o tempo limite. Tente novamente.');
    fail(502, 'Não foi possível obter uma resposta válida do Placa Fipe.');
  }
  if (!response.ok) fail(503, 'Placa Fipe indisponível. Verifique o plano e tente novamente mais tarde.');
  return normalizeVehicle(payload, requestedPlate);
}

export function selectVehicleOption(vehicle, index) {
  const option = vehicle.opcoes_fipe?.[index];
  if (!Number.isInteger(index) || !option) fail(400, 'Selecione um dos modelos retornados pela consulta.');
  return { ...vehicle, ...option, opcao_selecionada:index };
}
