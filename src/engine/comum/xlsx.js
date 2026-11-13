// Gravacao de xlsx: ExcelJS para as abas/estilos e injecao de graficos nativos
// do Excel (DrawingML) com fflate, ja que o ExcelJS nao cria graficos.
import ExcelJS from 'exceljs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

export { ExcelJS };

export function novaPasta() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Fatura Fhemig Online';
  wb.created = new Date();
  return wb;
}

export const cor = (hex) => ({ argb: `FF${hex.replace('#', '').toUpperCase()}` });
export const preenchimento = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: cor(hex) });

/** Letra da coluna (1 -> A). */
export function letra(n) {
  let s = '';
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/** Hiperlink interno como formula (abre direto no Excel e no LibreOffice). */
export function linkInterno(destino, texto) {
  const t = typeof texto === 'number' ? texto : `"${String(texto).replace(/"/g, '""')}"`;
  return { formula: `HYPERLINK("#${destino.replace(/"/g, '""')}",${t})`, result: texto };
}

export async function gravar(wb) {
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf);
}

// ---------------------------------------------------------------------------
// Graficos
// ---------------------------------------------------------------------------
const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_DRAWING = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing';
const REL_CHART = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart';
const CT_DRAWING = 'application/vnd.openxmlformats-officedocument.drawing+xml';
const CT_CHART = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function ref(aba, col1, lin1, col2, lin2) {
  const a = `'${aba.replace(/'/g, "''")}'`;
  return col2 ? `${a}!$${letra(col1)}$${lin1}:$${letra(col2)}$${lin2}` : `${a}!$${letra(col1)}$${lin1}`;
}

function titulo(texto, tamanho = 1400) {
  return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${tamanho}" b="1"/></a:pPr><a:r><a:rPr lang="pt-BR" sz="${tamanho}" b="1"/><a:t>${esc(texto)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
}

/**
 * spec: {aba, tipo: 'barra'|'linha', horizontal, titulo, tituloX, tituloY,
 *        serieNome: [col, lin], categorias: [col, lin1, lin2], valores: [col, lin1, lin2],
 *        ancora: [col0, lin0] (base zero), largura, altura (cm), rotulos, ordemInversa, cor}
 */
function xmlGrafico(g) {
  const nome = `<c:tx><c:strRef><c:f>${esc(ref(g.aba, g.serieNome[0], g.serieNome[1]))}</c:f></c:strRef></c:tx>`;
  const cat = `<c:cat><c:strRef><c:f>${esc(ref(g.aba, g.categorias[0], g.categorias[1], g.categorias[0], g.categorias[2]))}</c:f></c:strRef></c:cat>`;
  const val = `<c:val><c:numRef><c:f>${esc(ref(g.aba, g.valores[0], g.valores[1], g.valores[0], g.valores[2]))}</c:f></c:numRef></c:val>`;
  const corSerie = g.cor || '0092C3';
  const rotulos = g.rotulos
    ? '<c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>'
    : '';
  let plot;
  if (g.tipo === 'linha') {
    plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/>${nome}` +
      `<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="${corSerie}"/></a:solidFill><a:round/></a:ln></c:spPr>` +
      `<c:marker><c:symbol val="circle"/><c:size val="7"/><c:spPr><a:solidFill><a:srgbClr val="${corSerie}"/></a:solidFill></c:spPr></c:marker>` +
      `${rotulos}${cat}${val}<c:smooth val="0"/></c:ser><c:marker val="1"/><c:axId val="500000001"/><c:axId val="500000002"/></c:lineChart>`;
  } else {
    plot = `<c:barChart><c:barDir val="${g.horizontal ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/>${nome}` +
      `<c:spPr><a:solidFill><a:srgbClr val="${corSerie}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>${rotulos}${cat}${val}</c:ser>` +
      `<c:gapWidth val="80"/><c:axId val="500000001"/><c:axId val="500000002"/></c:barChart>`;
  }
  const horizontal = g.tipo !== 'linha' && g.horizontal;
  const eixoCat = `<c:catAx><c:axId val="500000001"/><c:scaling><c:orientation val="${g.ordemInversa ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/>` +
    `<c:axPos val="${horizontal ? 'l' : 'b'}"/>${g.tituloX && !horizontal ? titulo(g.tituloX, 1000) : ''}${g.tituloY && horizontal ? titulo(g.tituloY, 1000) : ''}` +
    '<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' +
    '<c:crossAx val="500000002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>';
  const eixoVal = `<c:valAx><c:axId val="500000002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>` +
    `<c:axPos val="${horizontal ? 'b' : 'l'}"/>${g.semGrade ? '' : '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>'}` +
    `${g.tituloY && !horizontal ? titulo(g.tituloY, 1000) : ''}${g.tituloX && horizontal ? titulo(g.tituloX, 1000) : ''}` +
    '<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' +
    `<c:crossAx val="500000001"/><c:crosses val="${g.ordemInversa && horizontal ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>`;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:roundedCorners val="0"/><c:chart>` +
    `${titulo(g.titulo)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}${eixoCat}${eixoVal}</c:plotArea>` +
    '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>' +
    '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:latin typeface="Calibri"/></a:defRPr></a:pPr><a:endParaRPr lang="pt-BR"/></a:p></c:txPr></c:chartSpace>';
}

const CM = 360000;

function ancora(g, idx, rid) {
  return `<xdr:oneCellAnchor><xdr:from><xdr:col>${g.ancora[0]}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${g.ancora[1]}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:ext cx="${Math.round((g.largura || 15) * CM)}" cy="${Math.round((g.altura || 7.5) * CM)}"/>` +
    `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${idx + 2}" name="Gráfico ${idx + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
    '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
    `<a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="${rid}"/></a:graphicData></a:graphic>` +
    '</xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>';
}

function abasDoWorkbook(arquivos) {
  const wbXml = strFromU8(arquivos['xl/workbook.xml']);
  const rels = strFromU8(arquivos['xl/_rels/workbook.xml.rels']);
  const alvos = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/Id="([^"]+)"/);
    const t = m[0].match(/Target="([^"]+)"/);
    if (id && t) {
      const c = t[1].replace(/^\//, '');
      alvos[id[1]] = c.startsWith('xl/') ? c : `xl/${c}`;
    }
  }
  const abas = {};
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const nome = m[0].match(/name="([^"]+)"/);
    const rid = m[0].match(/r:id="([^"]+)"/);
    if (nome && rid && alvos[rid[1]]) abas[nome[1].replace(/&amp;/g, '&')] = alvos[rid[1]];
  }
  return abas;
}

const ORDEM_APOS_DRAWING = ['<legacyDrawing', '<legacyDrawingHF', '<drawingHF', '<picture', '<oleObjects', '<controls', '<webPublishItems', '<tableParts', '<extLst', '</worksheet>'];

/** Injeta os graficos (lista de specs) no xlsx gravado pelo ExcelJS. */
export function injetarGraficos(bytes, graficos) {
  if (!graficos || !graficos.length) return bytes;
  const arquivos = unzipSync(bytes);
  const abas = abasDoWorkbook(arquivos);
  let ct = strFromU8(arquivos['[Content_Types].xml']);
  const porAba = new Map();
  for (const g of graficos) {
    if (!porAba.has(g.aba)) porAba.set(g.aba, []);
    porAba.get(g.aba).push(g);
  }
  let nDrawing = 0;
  let nChart = 0;
  for (const [aba, lista] of porAba) {
    const caminhoAba = abas[aba];
    if (!caminhoAba) continue;
    nDrawing += 1;
    const drawing = `xl/drawings/drawing${nDrawing}.xml`;
    const drawingRels = `xl/drawings/_rels/drawing${nDrawing}.xml.rels`;
    const anchors = [];
    const relsD = [];
    lista.forEach((g, i) => {
      nChart += 1;
      const chart = `xl/charts/chart${nChart}.xml`;
      arquivos[chart] = strToU8(xmlGrafico(g));
      relsD.push(`<Relationship Id="rId${i + 1}" Type="${REL_CHART}" Target="../charts/chart${nChart}.xml"/>`);
      anchors.push(ancora(g, i, `rId${i + 1}`));
      ct = ct.replace('</Types>', `<Override PartName="/${chart}" ContentType="${CT_CHART}"/></Types>`);
    });
    arquivos[drawing] = strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${NS_A}">${anchors.join('')}</xdr:wsDr>`,
    );
    arquivos[drawingRels] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relsD.join('')}</Relationships>`,
    );
    ct = ct.replace('</Types>', `<Override PartName="/${drawing}" ContentType="${CT_DRAWING}"/></Types>`);

    const pasta = caminhoAba.slice(0, caminhoAba.lastIndexOf('/'));
    const arquivoAba = caminhoAba.slice(caminhoAba.lastIndexOf('/') + 1);
    const relsAba = `${pasta}/_rels/${arquivoAba}.rels`;
    const rid = 'rIdGraficos1';
    const novaRel = `<Relationship Id="${rid}" Type="${REL_DRAWING}" Target="../drawings/drawing${nDrawing}.xml"/>`;
    if (arquivos[relsAba]) {
      arquivos[relsAba] = strToU8(strFromU8(arquivos[relsAba]).replace('</Relationships>', `${novaRel}</Relationships>`));
    } else {
      arquivos[relsAba] = strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${novaRel}</Relationships>`,
      );
    }
    let xml = strFromU8(arquivos[caminhoAba]);
    if (!/<worksheet\b[^>]*xmlns:r=/.test(xml)) xml = xml.replace('<worksheet', `<worksheet xmlns:r="${NS_R}"`);
    const tag = `<drawing r:id="${rid}"/>`;
    const pos = ORDEM_APOS_DRAWING.map((t) => xml.indexOf(t)).filter((p) => p >= 0).sort((a, b) => a - b)[0];
    xml = xml.slice(0, pos) + tag + xml.slice(pos);
    arquivos[caminhoAba] = strToU8(xml);
  }
  if (!ct.includes('Extension="rels"')) {
    ct = ct.replace('<Types', '<Types').replace('</Types>', '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>');
  }
  arquivos['[Content_Types].xml'] = strToU8(ct);
  return zipSync(arquivos, { level: 6 });
}

/** CSV com ';' e BOM UTF-8 (como o csv do Python com utf-8-sig). */
export function gerarCsv(colunas, linhas) {
  const q = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' && !Number.isInteger(v) ? String(v) : String(v);
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const corpo = [colunas.map(q).join(';'), ...linhas.map((l) => colunas.map((c) => q(l[c])).join(';'))].join('\r\n');
  return `﻿${corpo}\r\n`;
}
