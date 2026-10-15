// Apenas o processo isolado de teste importa este arquivo. Não é carregado pelo app.
process.env.PLACA_FIPE_TOKEN='test-only';
globalThis.fetch=async(url,options)=>{
 if(url!=='https://api.placafipe.com.br/getplacafipe')throw new Error('Destino inesperado no teste');
 const {placa}=JSON.parse(options.body);
 const row={marca:'TESTE',modelo:'MODELO A',ano_modelo:2025,codigo_fipe:'001001-1',mes_referencia:'outubro de 2026',combustivel:'GASOLINA',valor:'50000.00'};
 return {ok:true,json:async()=>({codigo:1,placa,informacoes_veiculo:{placa,ano_modelo:'2025',marca:'TESTE',modelo:'MODELO',segmento:'AUTO'},fipe:[row,{...row,modelo:'MODELO B',codigo_fipe:'001002-2',valor:'55000.00'}]})};
};
await import('../server/index.js');
