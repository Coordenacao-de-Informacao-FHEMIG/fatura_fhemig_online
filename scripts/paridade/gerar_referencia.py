# -*- coding: utf-8 -*-
"""Gera tests/referencia/*.json rodando os BACKENDS ORIGINAIS (Python) sobre a
massa sintetica de "arquivos de teste". O Vitest compara o motor JS com estes
arquivos (tests/paridade.test.js).

Uso (cada ferramenta com o Python portatil do proprio pacote):
  "<Fatura Fhemig 14.3>/_internal/python.exe"            gerar_referencia.py hospitalar
  "<Fatura Fhemig Ambulatorial 1.0>/_internal/python.exe" gerar_referencia.py ambulatorial
  "<ChecaProfissionais 2.0>/_internal/python.exe"         gerar_referencia.py checa

Nenhum dado real e lido: so os arquivos de teste e as bases SIGTAP publicas.
"""
import json
import sys
import tempfile
from pathlib import Path

WEB = Path(__file__).resolve().parents[2]
RAIZ = WEB.parent
TESTE = RAIZ / 'arquivos de teste'
SAIDA = WEB / 'tests' / 'referencia'
SAIDA.mkdir(parents=True, exist_ok=True)


def gravar(nome, dados):
    (SAIDA / nome).write_text(json.dumps(dados, ensure_ascii=False, indent=1, default=str), encoding='utf-8')
    print('gravado', nome)


def hospitalar():
    app = RAIZ / 'Fatura Fhemig 14.3'
    sys.path.insert(0, str(app / '_suporte' / 'codigo'))
    import backend as B
    H = TESTE / 'teste Hospitalar'
    bases = dict(
        servico=H / 'Serviço e Classificação HJXXIII (TESTE).xlsx',
        habilitacao=H / 'Habilitações HJXXIII (TESTE).xlsx',
        profissionais=H / 'Profissionais HJXXIII (TESTE).xlsx',
    )
    sigtap = B.load_sigtap(app / 'Sigtap')
    descricoes = B.carregar_descricoes_sigtap(app / 'Sigtap')
    for formato, nome in (('txt', 'SISAIH01_HJXXIII_202609_TESTE.txt'), ('pdf', 'Espelho_AIH_HJXXIII_202609_TESTE.pdf')):
        if formato == 'txt':
            espelho = B.converter_sisaih01_para_espelho(B.ler_txt(H / nome), descricoes)
        else:
            espelho = B.extrair_espelho_pdf(H / nome)
        rows = B.extract(
            espelho, sigtap, B.load_unit_service_classifications(bases['servico']),
            B.load_unit_habilitations(bases['habilitacao']), B.load_profissionais(bases['profissionais']),
            unidade='HJXXIII',
        )
        B.annotate_alerts(rows)
        records, counts = B.build_alert_records(rows)
        gravar(f'hospitalar_{formato}.json', {
            'linhas': [{
                'aih': r['AIH'], 'linha': r['Linha do procedimento'], 'codigo': r['Codigo do procedimento'],
                'alertas': r['ALERTAS'], 'diarias_maior': r['DIARIAS DE PERMANENCIA A MAIOR'],
                'reinternou': r['REINTERNOU (REAPARECE NA LISTAGEM DO PDF)?'],
                'reinternou72': r['REINTERNOU COM MENOS DE 72H (SEGUNDA ENTRADA MENOS PRIMEIRA SAIDA)?'],
                'idade': r['IDADE COMPLETA'], 'cbo': r['CBO E O MESMO DO SIGTAP?'], 'profissional': r['PROFISSIONAL E CBO CADASTRADOS?'],
            } for r in rows],
            'detalhes': [rec['Detalhe'] for rec in records],
            'contagens': [[c['label'], c['aihs'], c['procedimentos']] for c in counts],
            'cti': list(B.resumo_aih_tipo_cti(rows).items()),
        })


def ambulatorial():
    app = RAIZ / 'Fatura Fhemig Ambulatorial' / 'Fatura Fhemig Ambulatorial 1.0'
    sys.path.insert(0, str(app / '_suporte' / 'codigo'))
    import backend as B
    from openpyxl import load_workbook
    A = TESTE / 'teste Ambulatorial'
    for chave, nome in (('teste', 'BPA_HRBJA_202610_TESTE.txt'), ('cabecalho', 'BPA_HRBJA_202610_CABECALHO_INCONSISTENTE.txt')):
        with tempfile.TemporaryDirectory() as tmp:
            _, xlsx = B.process_arquivo(
                A / nome, app, lambda m: None, sigtap_path=app / 'SIGTAP102026.xlsx',
                profissionais_path=A / 'Profissionais HRBJA (TESTE).xlsx', carga_horaria_path=A / 'Carga Horária HRBJA (TESTE).xlsx',
                servico_path=A / 'Serviço Classificação HRBJA (TESTE).xlsx', habilitacao_path=A / 'Habilitações HRBJA (TESTE).xlsx',
                output_dir=tmp,
            )
            wb = load_workbook(xlsx, read_only=True)
            alertas = [list(r) for r in wb['Alertas'].iter_rows(values_only=True)]
            producao = [list(r) for r in wb['Producao'].iter_rows(values_only=True)]
            par = {r[0]: r[1] for r in wb['Parametros'].iter_rows(min_row=2, values_only=True)}
            wb.close()
        gravar(f'ambulatorial_{chave}.json', {'alertas': alertas, 'producao': producao, 'avisos': par.get('Avisos gerais')})


def checa():
    app = RAIZ / 'ChecaProfissionais 2.0'
    sys.path.insert(0, str(app / '_suporte' / 'codigo'))
    from core import leitura, regras
    import backend as B
    C = TESTE / 'teste ChecaProfissionais'
    cfg, _ = B.carregar_config(app)
    tasy = leitura.ler_fonte(C / 'Tasy Profissionais HIJPII (TESTE).xlsx', 'TASY', cfg['regras'])
    cnes = leitura.ler_fonte(C / 'CNES Profissionais HIJPII (TESTE).xlsx', 'CNES', cfg['regras'])
    adc = leitura.ler_fonte(C / 'Profissionais ADC (TESTE).xlsx', 'ADC', cfg['regras'])
    cbo = leitura.ler_fonte(C / 'CBO_assistencial (TESTE).xlsx', 'CBO_ASSIST', cfg['regras'])
    res = regras.executar(tasy, cnes, adc, cfg['regras'], cfg['alertas'], cfg['unidades'], cbo)
    ind = dict(res.indicadores)
    ind['alertas_por_codigo'] = dict(ind['alertas_por_codigo'])
    ind['alertas_por_severidade'] = dict(ind['alertas_por_severidade'])
    erro = ''
    try:
        cnes_hac = leitura.ler_fonte(C / 'CNES Profissionais HAC - UNIDADE ERRADA (TESTE).xlsx', 'CNES', cfg['regras'])
        regras.executar(tasy, cnes_hac, adc, cfg['regras'], cfg['alertas'], cfg['unidades'], cbo)
    except regras.ErroUnidade as e:
        erro = str(e)
    gravar('checa.json', {
        'alertas': [[a.codigo, a.nome, a.cpf, a.cns, a.cbo, a.mensagem, a.valor_tasy, a.valor_cnes, a.linhas_tasy, a.linhas_cnes] for a in res.alertas],
        'matriz': res.matriz,
        'indicadores': ind,
        'erro_unidade': erro,
    })


if __name__ == '__main__':
    {'hospitalar': hospitalar, 'ambulatorial': ambulatorial, 'checa': checa}[sys.argv[1]]()
