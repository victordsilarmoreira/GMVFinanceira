// Shared by the interface and API. Validate currency limits in integer cents.
export function financingLimits(fipe, parameters) {
  const cents = BigInt(Math.round(Number(fipe) * 100));
  const minRate = BigInt(Math.round(Number(parameters.percentual_min) * 100));
  const maxRate = BigInt(Math.round(Number(parameters.percentual_max) * 100));
  return {
    min: Number((cents * minRate + 9999n) / 10000n) / 100,
    max: Number(cents * maxRate / 10000n) / 100
  };
}

export function financingFromAmount(fipe, amount, installments, rate, parameters) {
  if (!Number.isFinite(Number(fipe)) || Number(fipe) <= 0) throw new Error('Consulte o valor FIPE antes de informar o valor financiado.');
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 1e9 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.0001) {
    throw new Error('Informe um valor financiado positivo, com no máximo duas casas decimais.');
  }
  const limits = financingLimits(fipe, parameters);
  if (amount < limits.min || amount > limits.max) {
    const currency = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    throw new Error(`O valor financiado deve ficar entre ${currency(limits.min)} e ${currency(limits.max)} (${Number(parameters.percentual_min)}% a ${Number(parameters.percentual_max)} da FIPE).`);
  }
  const principal = Math.round(amount * 100) / 100;
  const i = rate / 100;
  const payment = i === 0 ? principal / installments : principal * i / (-Math.expm1(-installments * Math.log1p(i)));
  return {
    percentual: Number((principal / Number(fipe) * 100).toFixed(8)),
    valor_financiado: principal,
    valor_parcela: Math.round(payment * 100) / 100
  };
}
