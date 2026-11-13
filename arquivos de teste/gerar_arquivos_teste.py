# -*- coding: utf-8 -*-
"""Gera a massa de teste SIMULADA do Fatura Fhemig Hospitalar, do Fatura Fhemig
Ambulatorial e do ChecaProfissionais.

NENHUM DADO REAL E USADO. Pacientes, profissionais, CPFs, CNS, numeros de AIH e
prontuarios sao inventados; CPFs e CNS sao gerados apenas com digito verificador
valido para passarem pelas validacoes de formato. Os nomes levam "FICTICIO(A)"
para deixar claro que sao simulados.

Os formatos foram extraidos SOMENTE do codigo dos backends:
  - Hospitalar 14.3: TXT posicional SISAIH01 (registros de 1800 colunas) e PDF
    do espelho da AIH com texto selecionavel (_suporte/codigo/backend.py).
  - Ambulatorial 1.0: TXT BPA (cabecalho 01, BPA-C 02, BPA-I 03) conforme
    config/layout_bpa.json e as planilhas de config/mapeamento_colunas.json.
  - ChecaProfissionais 2.0: planilhas Tasy, CNES, ADC e CBO assistencial
    conforme config/regras.json (assinaturas) e _suporte/codigo/tests/apoio.py.

Os procedimentos foram escolhidos na tabela SIGTAP publica (pasta Sigtap,
competencia 09/2026) para que cada cenario dispare um alerta conhecido.

Execucao (precisa de openpyxl e pymupdf; o Python portatil do Hospitalar tem os dois):
    "..\\Fatura Fhemig 14.3\\_internal\\python.exe" gerar_arquivos_teste.py
"""
import csv
from datetime import date
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

RAIZ = Path(__file__).resolve().parent
PASTA_HOSP = RAIZ / 'teste Hospitalar'
PASTA_AMB = RAIZ / 'teste Ambulatorial'
PASTA_CHECA = RAIZ / 'teste ChecaProfissionais'
SIGTAP_TXT = RAIZ.parent / 'Fatura Fhemig 14.3' / 'Sigtap'


# ===========================================================================
# Identificadores sinteticos
# ===========================================================================
def cpf(n):
    """CPF sintetico com digito verificador valido (base 9 digitos = n)."""
    base = f'{n:09d}'
    for k in (9, 10):
        soma = sum(int(base[i]) * (k + 1 - i) for i in range(k))
        base += str((soma * 10) % 11 % 10)
    return base


def cpf_dv_errado(n):
    valido = cpf(n)
    return valido[:-1] + str((int(valido[-1]) + 1) % 10)


def cns(n, prefixo='7'):
    """CNS sintetico de 15 digitos com DV valido (soma ponderada % 11 == 0)."""
    i = 0
    while True:
        c = f'{prefixo}{n:07d}{i:07d}'
        if sum(int(c[j]) * (15 - j) for j in range(15)) % 11 == 0:
            return c
        i += 1


def aaaammdd(d):
    return d.strftime('%Y%m%d')


def br(d):
    return d.strftime('%d/%m/%Y')


def idade_anos(nasc, ref):
    anos = ref.year - nasc.year
    if (ref.month, ref.day) < (nasc.month, nasc.day):
        anos -= 1
    return anos


# ===========================================================================
# Descricoes do SIGTAP (so para deixar o PDF legivel; nao ha regra aqui)
# ===========================================================================
def descricoes_sigtap():
    desc, cids = {}, {}
    try:
        with open(SIGTAP_TXT / 'tb_procedimento.txt', encoding='latin-1') as f:
            for linha in f:
                if linha.strip():
                    desc[linha[0:10]] = linha[10:260].strip()
        with open(SIGTAP_TXT / 'tb_cid.txt', encoding='latin-1') as f:
            for linha in f:
                if linha.strip():
                    cids[linha[0:4].strip()] = linha[4:104].strip()
    except OSError:
        pass
    return desc, cids


# ===========================================================================
# Planilhas
# ===========================================================================
CABECALHO = Font(bold=True, color='FFFFFF')
FUNDO = PatternFill('solid', fgColor='1F4E78')


def salvar_planilha(caminho, linhas, titulo_aba='Planilha1', linha_cabecalho=1, larguras=None):
    wb = Workbook()
    ws = wb.active
    ws.title = titulo_aba
    for linha in linhas:
        ws.append(linha)
    for cel in ws[linha_cabecalho]:
        if cel.value not in (None, ''):
            cel.font = CABECALHO
            cel.fill = FUNDO
    for i, largura in enumerate(larguras or [], 1):
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = largura
    wb.save(caminho)


# ===========================================================================
# HOSPITALAR
# ===========================================================================
COMP_HOSP = '202609'          # mesma competencia da pasta Sigtap do pacote
CNES_HJ = '0026921'           # HJXXIII (config/unidades.json do ChecaProfissionais)
CNES_TERCEIRO_CADASTRADO = '7777777'   # terceiro ficticio cadastrado na planilha
UNIDADE_HOSP = 'HJXXIII'

PROF_H = {
    'clinico':        {'nome': 'CARLOS FICTICIO MENDES',    'cns': cns(1001), 'cpf': cpf(810001001), 'cbo': '225125'},
    'clinico_cpf':    {'nome': 'HELENA FICTICIA PRADO',     'cns': cns(1002), 'cpf': cpf(810001002), 'cbo': '225125'},
    'radiologista':   {'nome': 'RAFAEL FICTICIO LIMA',      'cns': cns(1003), 'cpf': cpf(810001003), 'cbo': '225320'},
    'fisioterapeuta': {'nome': 'PAULA FICTICIA ANDRADE',    'cns': cns(1004), 'cpf': cpf(810001004), 'cbo': '223605'},
    'enfermeiro':     {'nome': 'JORGE FICTICIO NUNES',      'cns': cns(1005), 'cpf': cpf(810001005), 'cbo': '223505'},
    'ortopedista':    {'nome': 'MARCOS FICTICIO TEIXEIRA',  'cns': cns(1006), 'cpf': cpf(810001006), 'cbo': '225270'},
    'anestesista':    {'nome': 'SANDRA FICTICIA CORREA',    'cns': cns(1007), 'cpf': cpf(810001007), 'cbo': '225151'},
    'obstetra':       {'nome': 'LUCIA FICTICIA BARROS',     'cns': cns(1008), 'cpf': cpf(810001008), 'cbo': '225250'},
    'oftalmologista': {'nome': 'EDUARDO FICTICIO SALES',    'cns': cns(1009), 'cpf': cpf(810001009), 'cbo': '225265'},
}
# Profissional que NAO esta na planilha de Profissionais
PROF_H_NAO_CADASTRADO = {'nome': 'NAO CADASTRADO FICTICIO', 'cns': cns(1999), 'cbo': '225125'}


def p(codigo, qtd=1, prof=None, cbo=None, por_cpf=False, serv='', sem_doc=False, cnes=CNES_HJ):
    """Linha de procedimento da AIH."""
    prof = prof or {}
    if sem_doc:
        doc_tipo, doc = '', ''
    elif por_cpf:
        doc_tipo, doc = '1', prof['cpf']
    else:
        doc_tipo, doc = ('2', prof.get('cns', '')) if prof else ('', '')
    return {
        'codigo': codigo, 'qtd': qtd, 'doc_tipo': doc_tipo, 'doc': doc,
        'cbo': prof.get('cbo', '') if cbo is None else cbo,
        'cnes': cnes, 'servico': serv.split('-')[0] if serv else '',
        'classificacao': serv.split('-')[1] if serv else '',
    }


def cenarios_hospitalar():
    C, R, F = PROF_H['clinico'], PROF_H['radiologista'], PROF_H['fisioterapeuta']
    aihs = [
        dict(caso='H01', titulo='AIH limpa (profissional identificado por CPF)',
             nome='JOAO FICTICIO PEREIRA', mae='MARIA FICTICIA PEREIRA', nasc=date(1981, 3, 14), sexo='M',
             entrada=date(2026, 9, 1), saida=date(2026, 9, 4), principal='0303140151', cid='J189', cid_sec=['I10'],
             procs=[p('0303140151', 1, PROF_H['clinico_cpf'], por_cpf=True)],
             esperado=['Nenhum alerta']),
        dict(caso='H02', titulo='Admite permanencia a maior (atributo 004, 15 dias para media 4)',
             nome='ANTONIO FICTICIO RAMOS', mae='TEREZA FICTICIA RAMOS', nasc=date(1950, 6, 2), sexo='M',
             entrada=date(2026, 8, 20), saida=date(2026, 9, 4), principal='0303060212', cid='I500', cid_sec=['E119'],
             procs=[p('0303060212', 1, C)],
             esperado=['Admite permanência à maior (7 diárias: 15 dias - 2 x média 4)']),
        dict(caso='H03', titulo='UTI pediatrica sem habilitacao 2606 na unidade',
             nome='PEDRO FICTICIO ALVES', mae='CARLA FICTICIA ALVES', nasc=date(2018, 2, 10), sexo='M',
             entrada=date(2026, 9, 2), saida=date(2026, 9, 12), principal='0303010037', cid='A419', cid_sec=[],
             procs=[p('0303010037', 1, C), p('0802010075', 4, sem_doc=True)],
             esperado=['Sem habilitação (linha 2 - 0802010075 exige 2606)']),
        dict(caso='H04', titulo='Tomografias acima do limite e servico nao apresentado',
             nome='RITA FICTICIA GOMES', mae='LAURA FICTICIA GOMES', nasc=date(1975, 11, 30), sexo='F',
             entrada=date(2026, 9, 3), saida=date(2026, 9, 8), principal='0303140151', cid='J189', cid_sec=[],
             procs=[p('0303140151', 1, C), p('0206010079', 2, R, serv='121-003'), p('0206010079', 3, R)],
             esperado=['Quantidade acima da máxima (linhas 2 e 3 - total 5 tomografias > 3 por AIH)',
                       'Serviço não apresentado (linha 3 - tomografia sem 121-003)']),
        dict(caso='H05', titulo='Unidade sem servico exigido e servico so de terceiro com CNES diferente',
             nome='BEATRIZ FICTICIA COSTA', mae='ODETE FICTICIA COSTA', nasc=date(1968, 1, 22), sexo='F',
             entrada=date(2026, 9, 5), saida=date(2026, 9, 9), principal='0303050136', cid='H109', cid_sec=[],
             procs=[p('0303050136', 1, PROF_H['oftalmologista']), p('0302010017', 5, F, serv='126-001')],
             esperado=['Estabelecimento não possui serviço/classificação (linha 1 - 131-002 não cadastrado)',
                       'Estabelecimento não possui serviço/classificação (linha 2 - 126-001 só de terceiro 7777777)']),
        dict(caso='H06', titulo='CBO incompativel (enfermeiro em tratamento clinico)',
             nome='FERNANDO FICTICIO DIAS', mae='SONIA FICTICIA DIAS', nasc=date(1990, 7, 7), sexo='M',
             entrada=date(2026, 9, 6), saida=date(2026, 9, 8), principal='0303070102', cid='K922', cid_sec=[],
             procs=[p('0303070102', 1, PROF_H['enfermeiro'])],
             esperado=['CBO incompatível (223505 fora da lista do SIGTAP)']),
        dict(caso='H07', titulo='CBO nao informado',
             nome='CLAUDIA FICTICIA ROCHA', mae='VERA FICTICIA ROCHA', nasc=date(1985, 4, 18), sexo='F',
             entrada=date(2026, 9, 7), saida=date(2026, 9, 10), principal='0303010010', cid='A90', cid_sec=[],
             procs=[p('0303010010', 1, C, cbo='')],
             esperado=['CBO não informado']),
        dict(caso='H08', titulo='Profissional/CBO nao cadastrado na planilha de Profissionais',
             nome='MARCELO FICTICIO SOUZA', mae='IRENE FICTICIA SOUZA', nasc=date(1972, 9, 25), sexo='M',
             entrada=date(2026, 9, 8), saida=date(2026, 9, 12), principal='0303140151', cid='J189', cid_sec=[],
             procs=[p('0303140151', 1, PROF_H_NAO_CADASTRADO)],
             esperado=['Profissional/CBO não cadastrado']),
        dict(caso='H09', titulo='Sexo incompativel (RM de prostata em paciente feminina)',
             nome='JULIANA FICTICIA MOURA', mae='REGINA FICTICIA MOURA', nasc=date(1979, 12, 1), sexo='F',
             entrada=date(2026, 9, 9), saida=date(2026, 9, 12), principal='0303070102', cid='K922', cid_sec=[],
             procs=[p('0303070102', 1, C), p('0207030057', 1, R, serv='121-004')],
             esperado=['Sexo incompatível (linha 2 - 0207030057 só masculino)']),
        dict(caso='H10', titulo='Idade incompativel (parto normal aos 66 anos)',
             nome='NEUSA FICTICIA FARIA', mae='ADELIA FICTICIA FARIA', nasc=date(1960, 3, 3), sexo='F',
             entrada=date(2026, 9, 10), saida=date(2026, 9, 12), principal='0310010039', cid='O800', cid_sec=[],
             procs=[p('0310010039', 1, PROF_H['obstetra'])],
             esperado=['Idade incompatível (66 anos; faixa do SIGTAP 9 a 60 anos)']),
        dict(caso='H11', titulo='Reinternacao: 1a internacao do paciente',
             nome='WALTER FICTICIO BRAGA', mae='ZILDA FICTICIA BRAGA', nasc=date(1958, 5, 19), sexo='M',
             entrada=date(2026, 9, 2), saida=date(2026, 9, 5), principal='0303140151', cid='J189', cid_sec=[],
             procs=[p('0303140151', 1, C)],
             esperado=['Nenhum alerta (coluna REINTERNOU = NAO)']),
        dict(caso='H12', titulo='Reinternacao em menos de 72h (mesmo paciente da H11)',
             nome='WALTER FICTICIO BRAGA', mae='ZILDA FICTICIA BRAGA', nasc=date(1958, 5, 19), sexo='M',
             entrada=date(2026, 9, 7), saida=date(2026, 9, 11), principal='0303140151', cid='J189', cid_sec=[],
             procs=[p('0303140151', 1, C)],
             esperado=['Nenhum alerta (colunas REINTERNOU = SIM e MENOS DE 72H = SIM)']),
        dict(caso='H13', titulo='AIH com 11 procedimentos (registro de continuacao tipo 03)',
             nome='SILVIA FICTICIA PORTO', mae='ELZA FICTICIA PORTO', nasc=date(1966, 8, 8), sexo='F',
             entrada=date(2026, 9, 11), saida=date(2026, 9, 17), principal='0303010037', cid='A419', cid_sec=['E119', 'I10'],
             procs=[p('0303010037', 1, C)] + [
                 p(cod, 1, C, serv=sv) for cod, sv in (
                     ('0202010473', '145-001'), ('0202010317', '145-001'), ('0202010600', '145-001'),
                     ('0202010503', '145-001'), ('0202010295', '145-001'), ('0202010279', '145-001'),
                     ('0202010287', '145-001'), ('0202010538', '145-001'), ('0202020380', '145-002'),
                     ('0202020380', '145-002'))],
             esperado=['Nenhum alerta (testa a leitura do registro tipo 03)']),
        dict(caso='H14', titulo='Cirurgia com 2o executante (anestesista 225151 dispensa CBO)',
             nome='RICARDO FICTICIO MELO', mae='OLGA FICTICIA MELO', nasc=date(1993, 10, 12), sexo='M',
             entrada=date(2026, 9, 14), saida=date(2026, 9, 15), principal='0408050896', cid='M232', cid_sec=[],
             procs=[p('0408050896', 1, PROF_H['ortopedista']), p('0408050896', 1, PROF_H['anestesista'])],
             esperado=['Nenhum alerta (exceção do 2º executante e de cirurgia no HJXXIII)']),
    ]
    for i, a in enumerate(aihs, 1):
        a['aih'] = f'3126{i:08d}{i % 10}'           # 13 digitos, ficticio
        a['prontuario'] = f'{900000 + i}'
        a['solicitado'] = a['principal']
    return aihs


# --- TXT SISAIH01 -----------------------------------------------------------
def _gravar(reg, inicio, valor):
    for i, ch in enumerate(valor):
        reg[inicio + i] = ch


def _bloco_procedimento(item):
    bloco = [' '] * 79
    if item['doc']:
        _gravar(bloco, 0, item['doc_tipo'])
        _gravar(bloco, 1, item['doc'].zfill(15))
    if item['cbo']:
        _gravar(bloco, 16, item['cbo'].ljust(6))
    _gravar(bloco, 24, item['cnes'].zfill(14))
    _gravar(bloco, 40, item['cnes'].zfill(14))
    _gravar(bloco, 54, item['codigo'])
    _gravar(bloco, 64, f"{item['qtd']:03d}")
    _gravar(bloco, 67, COMP_HOSP)
    _gravar(bloco, 73, (item['servico'] or '000').zfill(3))
    _gravar(bloco, 76, (item['classificacao'] or '000').zfill(3))
    return ''.join(bloco)


def registros_sisaih01(a, sequencia):
    """Um registro tipo 01 (cabecalho + 9 procedimentos) e quantos tipo 03 forem precisos."""
    lotes = [a['procs'][i:i + 9] for i in range(0, len(a['procs']), 9)] or [[]]
    saida = []
    for n, lote in enumerate(lotes):
        reg = [' '] * 1800
        _gravar(reg, 0, f'{sequencia:05d}')
        _gravar(reg, 5, '000001')                     # lote
        _gravar(reg, 11, COMP_HOSP)                   # competencia de apresentacao
        _gravar(reg, 17, f'{n + 1:03d}')
        _gravar(reg, 43, a['aih'])
        _gravar(reg, 56, '01' if n == 0 else '03')
        if n == 0:
            _gravar(reg, 58, '03')                    # especialidade (clinica)
            _gravar(reg, 136, aaaammdd(a['entrada']))
            _gravar(reg, 144, aaaammdd(a['entrada']))
            _gravar(reg, 152, aaaammdd(a['saida']))
            _gravar(reg, 160, a['solicitado'])
            _gravar(reg, 171, a['principal'])
            _gravar(reg, 181, '02')                   # carater: urgencia
            _gravar(reg, 249, a['cid'].ljust(4))
            _gravar(reg, 268, a['nome'].ljust(70))
            _gravar(reg, 338, aaaammdd(a['nasc']))
            _gravar(reg, 346, a['sexo'])
            _gravar(reg, 347, '03')
            _gravar(reg, 349, a['mae'].ljust(70))
            _gravar(reg, 640, a['prontuario'].zfill(15))
            for k, cid in enumerate(a['cid_sec'][:9]):
                _gravar(reg, 1590 + 5 * k, cid.ljust(4) + '1')
        for k, item in enumerate(lote):
            _gravar(reg, 663 + 79 * k, _bloco_procedimento(item))
        saida.append(''.join(reg))
    return saida


def gerar_txt_sisaih01(aihs, caminho):
    linhas, seq = [], 1
    for a in aihs:
        for reg in registros_sisaih01(a, seq):
            linhas.append(reg)
            seq += 1
    caminho.write_bytes(('\r\n'.join(linhas) + '\r\n').encode('cp1252'))


# --- PDF do espelho -----------------------------------------------------------
NOMES_SERVICO = {
    '121-003': 'DIAGNOSTICO POR IMAGEM / TOMOGRAFIA COMPUTADORIZADA',
    '121-004': 'DIAGNOSTICO POR IMAGEM / RESSONANCIA MAGNETICA',
    '126-001': 'FISIOTERAPIA / ALTERACOES OBSTETRICAS, NEONATAIS E UROGIN.',
    '145-001': 'LABORATORIO CLINICO / EXAMES BIOQUIMICOS',
    '145-002': 'LABORATORIO CLINICO / EXAMES HEMATOLOGICOS',
}


def linhas_espelho(a, desc, cids):
    def fmt(c):
        return f'{c[0:2]}.{c[2:4]}.{c[4:6]}.{c[6:9]}-{c[9]}'
    sexo = {'M': 'MASCULINO', 'F': 'FEMININO'}[a['sexo']]
    out = [
        'ESPELHO DA AIH - DADOS SIMULADOS PARA TESTE',
        f"Num AIH : {a['aih'][:12]}-{a['aih'][12]}",
        f'Apresentação : {COMP_HOSP[4:]}/{COMP_HOSP[:4]}',
        f"Paciente : {a['nome']} Prontuário : {a['prontuario']}",
        f"Nome da Mae : {a['mae']}",
        f"Data Nasc. : {br(a['nasc'])} Sexo : {sexo}",
        f"Data internação : {br(a['entrada'])} Data saída : {br(a['saida'])}",
        f"Procedimento solicitado : {fmt(a['solicitado'])}",
        f"Procedimento principal : {fmt(a['principal'])}",
        f"Diag. principal : {a['cid']}-{cids.get(a['cid'], 'NAO INFORMADO')[:60]}",
        'PROCEDIMENTOS REALIZADOS',
        'Linha Procedimento Documento CBO CNES/CNPJ Apurar Valor p/ Qtde Cmpt Descricao',
    ]
    servicos = []
    for n, item in enumerate(a['procs'], 1):
        partes = [str(n), item['codigo']]
        if item['doc']:
            partes.append(item['doc'])
        if item['cbo']:
            partes.append(item['cbo'])
        partes += [item['cnes'], item['cnes'], str(item['qtd']), f'{COMP_HOSP[4:]}/{COMP_HOSP[:4]}',
                   desc.get(item['codigo'], 'PROCEDIMENTO')[:55]]
        out.append(' '.join(partes))
        if item['servico']:
            par = f"{item['servico']}-{item['classificacao']}"
            servicos.append(f"{n} {item['servico']} {item['classificacao']} {NOMES_SERVICO.get(par, '')}".rstrip())
    out += ['SERVICO/CLASSIFICACAO', 'Linha Servico Classificacao'] + servicos
    out += ['CID SECUNDÁRIO', 'Cid Caracteristica Descricao']
    out += [f"{c} 1 {cids.get(c, 'NAO INFORMADO')[:50]}" for c in a['cid_sec']]
    return out


def gerar_pdf_espelho(aihs, caminho, desc, cids):
    import pymupdf
    doc = pymupdf.open()
    for a in aihs:
        pagina = doc.new_page(width=842, height=595)       # A4 paisagem
        y = 40
        for linha in linhas_espelho(a, desc, cids):
            negrito = linha.isupper() and not linha[:1].isdigit()
            pagina.insert_text((36, y), linha, fontname='hebo' if negrito else 'helv', fontsize=9)
            y += 15
    doc.set_metadata({'title': 'Espelho de AIH - dados simulados', 'author': 'Massa de teste Fatura Fhemig'})
    doc.save(caminho)
    doc.close()


def gerar_bases_hospitalar(pasta):
    # Servico/Classificacao: linha 1 = cabecalho com Codigo, Terceiro e CNES (load_unit_service_classifications)
    salvar_planilha(pasta / f'Serviço e Classificação {UNIDADE_HOSP} (TESTE).xlsx', [
        ['Código', 'Serviço', 'Classificação', 'Terceiro', 'CNES'],
        ['121 - 003', 'DIAGNOSTICO POR IMAGEM', 'TOMOGRAFIA COMPUTADORIZADA', 'NAO', CNES_HJ],
        ['121 - 004', 'DIAGNOSTICO POR IMAGEM', 'RESSONANCIA MAGNETICA', 'NAO', CNES_HJ],
        ['145 - 001', 'LABORATORIO CLINICO', 'EXAMES BIOQUIMICOS', 'NAO', CNES_HJ],
        ['145 - 002', 'LABORATORIO CLINICO', 'EXAMES HEMATOLOGICOS', 'NAO', CNES_HJ],
        ['126 - 001', 'FISIOTERAPIA', 'ALTERACOES OBSTETRICAS, NEONATAIS E UROGINECOLOGICAS', 'SIM', CNES_TERCEIRO_CADASTRADO],
        # 131-002 (oftalmologia clinica) fica de fora de proposito -> caso H05
    ], larguras=[12, 26, 52, 10, 10])
    # Habilitacoes: titulo na 1a linha e coluna "Habilitação" (load_unit_habilitations procura nas 20 primeiras)
    salvar_planilha(pasta / f'Habilitações {UNIDADE_HOSP} (TESTE).xlsx', [
        [f'{CNES_HJ} - HOSPITAL JOAO XXIII (DADOS DE TESTE)'],
        ['Habilitação', 'Comp. Inicial', 'Comp. Final'],
        ['2601 - UNIDADE DE TERAPIA INTENSIVA ADULTO TIPO II', '01/2020', '99/9999'],
        ['3801 - PROGRAMA MAIS ACESSO A ESPECIALISTAS', '01/2025', '99/9999'],
        # 2606 (UTI pediatrica III) fica de fora de proposito -> caso H03
    ], linha_cabecalho=2, larguras=[55, 14, 14])
    # Profissionais: CNS e CBO obrigatorios, CPF opcional (load_profissionais)
    linhas = [['NOME', 'CNS', 'CPF', 'CBO']]
    for prof in PROF_H.values():
        linhas.append([prof['nome'], prof['cns'], prof['cpf'], prof['cbo']])
    salvar_planilha(pasta / f'Profissionais {UNIDADE_HOSP} (TESTE).xlsx', linhas, larguras=[32, 18, 14, 10])


# ===========================================================================
# AMBULATORIAL (BPA)
# ===========================================================================
COMP_AMB = '202610'           # mesma competencia do SIGTAP102026.xlsx do pacote ambulatorial
CNES_HRBJA = '3698548'
CNES_TERCEIRO_AMB = '7654321'
IBGE_BARBACENA = '310560'

PROF_A = {
    'clinico':     {'nome': 'ROBERTO FICTICIO VIANA',  'cns': cns(2001), 'cpf': cpf(820002001), 'cbos': ['225125'], 'ch': {'225125': (20, 20, 0)}},
    'residente':   {'nome': 'TATIANA FICTICIA LOPES',  'cns': cns(2002), 'cpf': cpf(820002002), 'cbos': ['2231F9'], 'ch': {'2231F9': (30, 30, 0)}},
    'cardio':      {'nome': 'GUSTAVO FICTICIO PINTO',  'cns': cns(2003), 'cpf': cpf(820002003), 'cbos': ['225120'], 'ch': {'225120': (0, 40, 0)}},
    'enfermeira':  {'nome': 'DENISE FICTICIA CAMPOS',  'cns': cns(2004), 'cpf': cpf(820002004), 'cbos': ['223505'], 'ch': {'223505': (30, 0, 0)}},
    'infecto':     {'nome': 'VALERIA FICTICIA REIS',   'cns': cns(2005), 'cpf': cpf(820002005), 'cbos': ['225103'], 'ch': {}},
    'bioquimico':  {'nome': 'OTAVIO FICTICIO MATOS',   'cns': cns(2006), 'cpf': cpf(820002006), 'cbos': ['221105'], 'ch': {'221105': (40, 0, 0)}},
}
PROF_A_NAO_CADASTRADO = {'cns': cns(2999), 'cbos': ['225125']}

PACIENTES_A = [
    # nome (ate 30), nascimento, sexo, cpf
    ('ALICE FICTICIA MORAIS', date(1988, 2, 14), 'F', cpf(830003001)),
    ('BRUNO FICTICIO TAVARES', date(1975, 7, 30), 'M', cpf(830003002)),
    ('CECILIA FICTICIA RANGEL', date(2001, 11, 5), 'F', cpf(830003003)),
    ('DANIEL FICTICIO QUEIROZ', date(1960, 4, 21), 'M', cpf(830003004)),
    ('ELISA FICTICIA FONSECA', date(1995, 9, 9), 'F', cpf(830003005)),
    ('FABIO FICTICIO CARDOSO', date(1949, 12, 25), 'M', cpf(830003006)),
    ('GABRIELA FICTICIA NOGUEIRA', date(2010, 6, 1), 'F', cpf(830003007)),
    ('HUGO FICTICIO MACHADO', date(1983, 3, 17), 'M', cpf(830003008)),
    ('IARA FICTICIA BEZERRA', date(1970, 8, 28), 'F', cpf(830003009)),
    ('JOSE FICTICIO AMARAL', date(1955, 1, 3), 'M', cpf(830003010)),
]


def _campo_bpa(valor, tamanho, tipo):
    valor = '' if valor is None else str(valor)
    if tipo == 'int':
        return valor.zfill(tamanho)[-tamanho:] if valor else ' ' * tamanho
    return valor[:tamanho].ljust(tamanho)


LAYOUT_BPA_I = [  # (campo, tamanho, tipo) na ordem de config/layout_bpa.json
    ('tipo_registro', 2, 'txt'), ('cnes', 7, 'txt'), ('competencia', 6, 'txt'), ('cns_profissional', 15, 'txt'),
    ('cbo', 6, 'txt'), ('data_atendimento', 8, 'txt'), ('folha', 3, 'txt'), ('sequencia', 2, 'txt'),
    ('procedimento', 10, 'txt'), ('cns_paciente', 15, 'txt'), ('sexo', 1, 'txt'), ('ibge_municipio', 6, 'txt'),
    ('cid', 4, 'txt'), ('idade', 3, 'int'), ('quantidade', 6, 'int'), ('carater_atendimento', 2, 'txt'),
    ('num_autorizacao', 13, 'txt'), ('origem', 3, 'txt'), ('nome_paciente', 30, 'alfa'),
    ('data_nascimento', 8, 'txt'), ('raca_cor', 2, 'txt'), ('etnia', 4, 'txt'), ('nacionalidade', 3, 'txt'),
    ('servico', 3, 'txt'), ('classificacao', 3, 'txt'), ('equipe_seq', 8, 'txt'), ('equipe_area', 4, 'txt'),
    ('cnpj_opm', 14, 'txt'), ('cep_paciente', 8, 'txt'), ('cod_logradouro', 3, 'txt'), ('endereco', 30, 'alfa'),
    ('complemento', 10, 'alfa'), ('numero', 5, 'alfa'), ('bairro', 30, 'alfa'), ('telefone', 11, 'txt'),
    ('email', 40, 'alfa'), ('ine', 10, 'txt'), ('cpf_paciente', 11, 'txt'), ('situacao_rua', 1, 'txt'),
    ('sem_cpf', 1, 'txt'),
]
LAYOUT_BPA_C = [
    ('tipo_registro', 2, 'txt'), ('cnes', 7, 'txt'), ('competencia', 6, 'txt'), ('cbo', 6, 'txt'),
    ('folha', 3, 'txt'), ('sequencia', 2, 'txt'), ('procedimento', 10, 'txt'), ('idade', 3, 'int'),
    ('quantidade', 6, 'int'), ('origem', 3, 'txt'),
]


def montar(layout, dados):
    return ''.join(_campo_bpa(dados.get(n), t, tp) for n, t, tp in layout)


def cenarios_bpa():
    """Lista de (tipo, dados, caso, esperado) na ordem do arquivo."""
    PA = PROF_A
    data_atend = date(2026, 10, 15)
    linhas = []

    def bpa_c(caso, esperado, proc, cbo, qtd, idade=0, folha='001'):
        linhas.append(('C', dict(tipo_registro='02', cnes=CNES_HRBJA, competencia=COMP_AMB, cbo=cbo, folha=folha,
                                 procedimento=proc, idade=idade, quantidade=qtd, origem='BPA'), caso, esperado))

    def bpa_i(caso, esperado, proc, prof, pac, cbo=None, qtd=1, serv='', cpf_pac=None, cid='', folha='001'):
        nome, nasc, sexo, cpf_ok = PACIENTES_A[pac]
        linhas.append(('I', dict(
            tipo_registro='03', cnes=CNES_HRBJA, competencia=COMP_AMB, cns_profissional=prof['cns'],
            cbo=cbo if cbo is not None else prof['cbos'][0], data_atendimento=aaaammdd(data_atend), folha=folha,
            procedimento=proc, cns_paciente=cns(3000 + pac, prefixo='8'), sexo=sexo, ibge_municipio=IBGE_BARBACENA,
            cid=cid, idade=idade_anos(nasc, data_atend), quantidade=qtd, carater_atendimento='01', origem='BPA',
            nome_paciente=nome, data_nascimento=aaaammdd(nasc), raca_cor='03', nacionalidade='010',
            servico=serv.split('-')[0] if serv else '', classificacao=serv.split('-')[1] if serv else '',
            cep_paciente='36200000', cod_logradouro='081', endereco='RUA FICTICIA DOS TESTES',
            numero='100', bairro='CENTRO', cpf_paciente=cpf_ok if cpf_pac is None else cpf_pac,
            situacao_rua='N'), caso, esperado))

    # --- BPA-C (consolidado) ---
    bpa_c('A01', 'Nenhum alerta', '0301100039', '223505', 40)
    bpa_c('A02', 'R08 (exige habilitação 0638/0639/0640) e R10 (exige 115-011)', '0101050186', '223505', 12)
    bpa_c('A03', 'R10 - Unidade sem o serviço/classificação 115-011', '0101050194', '223505', 8)
    bpa_c('A04', 'R02 - Procedimento inexistente no SIGTAP', '0399999999', '223505', 3)
    # --- BPA-I (individualizado) ---
    bpa_i('A05', 'Nenhum alerta', '0301010072', PA['clinico'], 0, folha='002')
    bpa_i('A06', 'Nenhum alerta (CBO alfanumérico 2231F9)', '0301010072', PA['residente'], 1, folha='002')
    bpa_i('A07', 'R11 - CPF obrigatório (atributo 058) não informado', '0301010072', PA['clinico'], 2, cpf_pac='', folha='002')
    bpa_i('A08', 'R11 - CPF obrigatório com dígito verificador inválido', '0301010072', PA['clinico'], 3,
          cpf_pac=cpf_dv_errado(830003004), folha='002')
    bpa_i('A09', 'R04 - CNS do profissional não cadastrado (e R06)', '0301010072',
          {'cns': PROF_A_NAO_CADASTRADO['cns'], 'cbos': ['225125']}, 4, folha='002')
    bpa_i('A10', 'R05 - CBO 225124 não vinculado ao profissional (e R06)', '0301010072', PA['clinico'], 5,
          cbo='225124', folha='002')
    bpa_i('A11', 'R06 - Carga horária ambulatorial zerada', '0301010072', PA['cardio'], 6, folha='002')
    bpa_i('A12', 'R06 - Profissional sem linha na planilha de Carga horária', '0301010072', PA['infecto'], 7, folha='002')
    bpa_i('A13', 'R08 - Habilitação 1102 fora da vigência (encerrada em 06/2026)', '0202030024', PA['bioquimico'], 8,
          serv='145-003', cid='B24', folha='002')
    bpa_i('A14', 'R10 - Serviço só de terceiro com CNES diferente', '0211020036', PA['clinico'], 9,
          serv='113-001', folha='002')
    bpa_i('A15', 'R10 - Serviço/classificação informado incompatível (145-002 em vez de 145-001)', '0202010473',
          PA['bioquimico'], 0, serv='145-002', folha='003')
    bpa_i('A16', 'Nenhum alerta (exame com serviço próprio 145-001)', '0202010473', PA['bioquimico'], 1,
          serv='145-001', folha='003')
    return linhas


def campo_controle(registros):
    soma = 0
    for _tipo, d, _c, _e in registros:
        if str(d.get('procedimento', '')).isdigit():
            soma += int(d['procedimento'])
        soma += int(d.get('quantidade') or 0)
    return soma % 1111 + 1111


def cabecalho_bpa(registros, total_linhas, folhas, controle=None):
    controle = campo_controle(registros) if controle is None else controle
    return (
        '01' + '#BPA#' + COMP_AMB + f'{total_linhas:06d}' + f'{folhas:06d}' + f'{controle:04d}'
        + 'HOSPITAL REGIONAL BARBACENA TE'[:30].ljust(30) + 'HRBJA '[:6]
        + '00000000000191' + 'SECRETARIA ESTADUAL DE SAUDE (TESTE)'.ljust(40)[:40] + 'E' + 'TESTE 1.0 '[:10]
    )


def gerar_txt_bpa(pasta):
    registros = cenarios_bpa()
    corpo = []
    for tipo, dados, _c, _e in registros:
        corpo.append(montar(LAYOUT_BPA_I if tipo == 'I' else LAYOUT_BPA_C, dados))


    # 1) arquivo principal: cabecalho consistente + 2 linhas invalidas (R01) no fim
    invalidas = [
        '03' + CNES_HRBJA + COMP_AMB + PROF_A['clinico']['cns'] + '225125' + '20261015' + '00399'
        + '0301010072',                                   # BPA-I truncada (A17)
        '04' + CNES_HRBJA + COMP_AMB + ' ' * 30,          # tipo de registro desconhecido (A18)
    ]
    todas = corpo + invalidas
    # Controle e folhas calculados como o leitor faz: a linha truncada conta como BPA-I
    # (folha 003, procedimento 0301010072, sem quantidade); a de tipo "04" nao entra.
    controle = campo_controle(registros + [('I', {'procedimento': '0301010072', 'quantidade': 0}, '', '')])
    folhas_reais = len({(t, d['folha']) for t, d, _c, _e in registros} | {('I', '003')})
    cab = cabecalho_bpa(registros, len(todas) + 1, folhas_reais, controle)
    (pasta / f'BPA_HRBJA_{COMP_AMB}_TESTE.txt').write_bytes(
        ('\r\n'.join([cab] + todas) + '\r\n').encode('latin-1'))

    # 2) arquivo com cabecalho inconsistente (testa os avisos gerais do cabecalho)
    cab_ruim = cabecalho_bpa(registros, 999, 99, 1234)
    (pasta / f'BPA_HRBJA_{COMP_AMB}_CABECALHO_INCONSISTENTE.txt').write_bytes(
        ('\r\n'.join([cab_ruim] + corpo) + '\r\n').encode('latin-1'))

    esperado = [(c, 'BPA-' + t, d['procedimento'], e) for t, d, c, e in registros]
    esperado.append(('A17', 'BPA-I', '0301010072', 'R01 - Linha inválida (BPA-I truncada)'))
    esperado.append(('A18', '?', '-', 'R01 - Linha inválida (tipo de registro desconhecido "04")'))
    return esperado


def gerar_bases_ambulatorial(pasta):
    linhas = [['CNS', 'NOME', 'CBO', 'CPF', 'VINCULO']]
    for prof in PROF_A.values():
        for cbo in prof['cbos']:
            linhas.append([prof['cns'], prof['nome'], cbo, prof['cpf'], 'ESTATUTARIO'])
    salvar_planilha(pasta / 'Profissionais HRBJA (TESTE).xlsx', linhas, larguras=[18, 32, 10, 14, 14])

    linhas = [['CNS', 'NOME', 'CBO', 'AMB.', 'HOSP.', 'OUTROS']]
    for prof in PROF_A.values():
        for cbo, (amb, hosp, outros) in prof['ch'].items():
            linhas.append([prof['cns'], prof['nome'], cbo, amb, hosp, outros])
    salvar_planilha(pasta / 'Carga Horária HRBJA (TESTE).xlsx', linhas, larguras=[18, 32, 10, 8, 8, 8])

    salvar_planilha(pasta / 'Serviço Classificação HRBJA (TESTE).xlsx', [
        ['CODIGO', 'SERVICO', 'CLASSIFICACAO', 'TERCEIRO', 'CNES'],
        ['145 - 001', 'LABORATORIO CLINICO', 'EXAMES BIOQUIMICOS', 'NAO', CNES_HRBJA],
        ['145 - 003', 'LABORATORIO CLINICO', 'EXAMES SOROLOGICOS E IMUNOLOGICOS', 'NAO', CNES_HRBJA],
        ['113 - 001', 'ATENCAO DOMICILIAR', 'ASSISTENCIA DOMICILIAR', 'SIM', CNES_TERCEIRO_AMB],
        # 115-011 fica de fora de proposito -> casos A02 e A03
    ], larguras=[12, 26, 40, 10, 10])

    salvar_planilha(pasta / 'Habilitações HRBJA (TESTE).xlsx', [
        [f'{CNES_HRBJA} - HOSPITAL REGIONAL DE BARBACENA DR. JOSE AMERICO (DADOS DE TESTE)'],
        ['Habilitação', 'Comp. Inicial', 'Comp. Final'],
        ['1102 - LABORATORIO ESPECIALIZADO EM CD4/CD8 E HIV', '01/2024', '06/2026'],   # vencida -> A13
        ['2601 - UNIDADE DE TERAPIA INTENSIVA ADULTO TIPO II', '01/2020', '99/9999'],
    ], linha_cabecalho=2, larguras=[55, 14, 14])


# ===========================================================================
# CHECAPROFISSIONAIS
# ===========================================================================
CAB_TASY = ['Cd pessoa fisica', 'Nome pessoa física', 'Nr cpf', 'Data nasc', 'Crm', 'Conselho', 'Cns', 'Cbo',
            'Especialidade', 'Vínculo', 'Cd estabelecimento', 'Estabelcimento', 'Funcionário?']
VAZIO = '                         '      # o Tasy exporta campo vazio como espacos
COD_TASY_HIJPII, SIGLA_HIJPII, CNES_HIJPII = 8, 'HIJPII', '0026948'


def cenarios_checa():
    """(caso, descricao, linhas_tasy, linhas_cnes, linhas_adc, esperado)."""
    c, k = cpf, cns
    casos = []

    def caso(cod, desc, tasy=(), cnes_=(), adc=(), esperado=''):
        casos.append((cod, desc, list(tasy), list(cnes_), list(adc), esperado))

    def t(nome, cpf_, cns_, cbo, **kw):
        return dict(nome=nome, cpf=cpf_, cns=cns_, cbo=cbo, **kw)

    caso('C01', 'Profissional igual nas duas fontes (pediatra assistencial)',
         [t('ANA FICTICIA ROCHA', c(840004001), k(4001), '225124', especialidade='PEDIATRIA')],
         [t('ANA FICTICIA ROCHA', c(840004001), k(4001), '225124', descricao='MEDICO PEDIATRA')],
         esperado='Sem divergência; entra em CBO_Assistencial')
    caso('C02', 'Dois CBOs iguais nas duas fontes, um alfanumérico (2231F9)',
         [t('BRUNA FICTICIA SANTOS', c(840004002), k(4002), '225125'),
          t('BRUNA FICTICIA SANTOS', c(840004002), k(4002), '2231F9')],
         [t('BRUNA FICTICIA SANTOS', c(840004002), k(4002), '225125', descricao='MEDICO CLINICO'),
          t('BRUNA FICTICIA SANTOS', c(840004002), k(4002), '2231F9', descricao='MEDICO RESIDENTE')],
         esperado='Sem divergência; informativo de vários CBOs válidos')
    caso('C03', 'Profissional só no Tasy',
         [t('CAIO FICTICIO MOREIRA', c(840004003), k(4003), '223505')], [],
         esperado='Profissional não encontrado no CNES (D002)')
    caso('C04', 'Profissional só no CNES', [],
         [t('DEBORA FICTICIA CUNHA', c(840004004), k(4004), '322205', descricao='TECNICO DE ENFERMAGEM')],
         esperado='Profissional não encontrado no Tasy (D006)')
    caso('C05', 'CBO a mais no Tasy',
         [t('EDSON FICTICIO PAIVA', c(840004005), k(4005), '225125'),
          t('EDSON FICTICIO PAIVA', c(840004005), k(4005), '225150')],
         [t('EDSON FICTICIO PAIVA', c(840004005), k(4005), '225125', descricao='MEDICO CLINICO')],
         esperado='CBO não cadastrado no CNES (D004) para 225150 + CBO diferente (D007) + Vários CBOs (I003)')
    caso('C06', 'CBO a mais no CNES',
         [t('FLAVIA FICTICIA XAVIER', c(840004006), k(4006), '223505')],
         [t('FLAVIA FICTICIA XAVIER', c(840004006), k(4006), '223505', descricao='ENFERMEIRO'),
          t('FLAVIA FICTICIA XAVIER', c(840004006), k(4006), '223510', descricao='ENFERMEIRO AUDITOR')],
         esperado='CBO não cadastrado no Tasy (D005) para 223510 + CBO diferente (D007)')
    caso('C07', 'Mesmo número de CBOs, códigos diferentes',
         [t('GILSON FICTICIO PRATES', c(840004007), k(4007), '322205')],
         [t('GILSON FICTICIO PRATES', c(840004007), k(4007), '515105', descricao='AGENTE COMUNITARIO DE SAUDE')],
         esperado='CBO diferente no Tasy e CNES (D007) + D004 (322205) + D005 (515105)')
    caso('C08', 'CNS diferente entre Tasy e CNES (mesmo CPF)',
         [t('HELIO FICTICIO GUSMAO', c(840004008), k(4008), '225125')],
         [t('HELIO FICTICIO GUSMAO', c(840004008), k(4108), '225125', descricao='MEDICO CLINICO')],
         esperado='CNS diferente no Tasy e CNES (D003)')
    caso('C09', 'CPF com dígito verificador inválido no Tasy',
         [t('IVONE FICTICIA BASTOS', cpf_dv_errado(840004009), k(4009), '223505')],
         [t('IVONE FICTICIA BASTOS', c(840004009), k(4009), '223505', descricao='ENFERMEIRO')],
         esperado='CPF inválido (Q001), cruzamento pelo CNS')
    caso('C10', 'CPF ausente no Tasy, cruza pelo CNS',
         [t('JAIME FICTICIO LOBO', VAZIO, k(4010), '225125')],
         [t('JAIME FICTICIO LOBO', c(840004010), k(4010), '225125', descricao='MEDICO CLINICO')],
         esperado='CPF ausente (Q003)')
    caso('C11', 'Sem CPF e sem CNS no Tasy',
         [t('KATIA FICTICIA BRITO', VAZIO, VAZIO, '223505')], [],
         esperado='Trilha SEM_IDENTIFICADOR (Registros_Especiais) + Elegibilidade em revisão (I004)')
    caso('C12', 'Registros técnicos (TESTE, PAINEL, TOTEM)',
         [t('USUARIO TESTE FATURAMENTO', c(840004012), k(4012), '225125'),
          t('PAINEL CHAMADA PRONTO SOCORRO', VAZIO, VAZIO, VAZIO),
          t('TOTEM AUTOATENDIMENTO', VAZIO, VAZIO, VAZIO)], [],
         esperado='Registros_Especiais (I002), fora da comparação')
    caso('C13', 'Profissional da ADC presente no Tasy e no CNES da unidade',
         [t('LEONARDO FICTICIO ADC', c(840004013), k(4013), '252105')],
         [t('LEONARDO FICTICIO ADC', c(840004013), k(4013), '252105', descricao='ADMINISTRADOR')],
         [t('LEONARDO FICTICIO ADC', c(840004013), k(4013), '252105')],
         esperado='Retirado nas duas fontes (I001 / Exclusoes_ADC)')
    caso('C14', 'Tasy sem CBO (elegibilidade em revisão)',
         [t('MONICA FICTICIA LEAL', c(840004014), k(4014), VAZIO)], [],
         esperado='Sem CBO no Tasy (Q005); NÃO gera Profissional não encontrado no CNES (D002)')
    caso('C15', 'Mesmo CNS em duas pessoas com CPFs diferentes',
         [t('NILTON FICTICIO PAZ', c(840004015), k(4015), '225125'),
          t('NADIA FICTICIA PAZ', c(840004115), k(4015), '223505')],
         [t('NILTON FICTICIO PAZ', c(840004015), k(4015), '225125', descricao='MEDICO CLINICO')],
         esperado='Mesmo CNS em CPFs diferentes (D001) + D002 para NADIA (só no Tasy)')
    caso('C16', 'Linha repetida no Tasy',
         [t('OSCAR FICTICIO VALE', c(840004016), k(4016), '225125'),
          t('OSCAR FICTICIO VALE', c(840004016), k(4016), '225125')],
         [t('OSCAR FICTICIO VALE', c(840004016), k(4016), '225125', descricao='MEDICO CLINICO')],
         esperado='Linha repetida (Q007)')
    caso('C17', 'Mesmo CPF em dois cadastros do Tasy (Cd pessoa diferente)',
         [t('PRISCILA FICTICIA LUZ', c(840004017), k(4017), '225125', cd=5017),
          t('PRISCILA FICTICIA LUZ', c(840004017), k(4017), '225125', cd=6017)],
         [t('PRISCILA FICTICIA LUZ', c(840004017), k(4017), '225125', descricao='MEDICO CLINICO')],
         esperado='Mesmo CPF em mais de um cadastro do Tasy (Q011)')
    caso('C18', 'Dois CNS para o mesmo CPF no Tasy',
         [t('QUITERIA FICTICIA SA', c(840004018), k(4018), '223505'),
          t('QUITERIA FICTICIA SA', c(840004018), k(4118), '322205')],
         [t('QUITERIA FICTICIA SA', c(840004018), k(4018), '223505', descricao='ENFERMEIRO')],
         esperado='Mais de um CNS para o mesmo CPF (Q009) + D004 (322205) + D007 + I003')
    caso('C19', 'Nome diferente para o mesmo CPF',
         [t('RENATO FICTICIO SILVEIRA', c(840004019), k(4019), '225125')],
         [t('RENATA FICTICIA SILVEIRA', c(840004019), k(4019), '225125', descricao='MEDICO CLINICO')],
         esperado='Nome diferente para o mesmo CPF (Q006)')
    caso('C20', 'CBO inválido no Tasy',
         [t('SAULO FICTICIO MOTA', c(840004020), k(4020), '22512A9')],
         [t('SAULO FICTICIO MOTA', c(840004020), k(4020), '225125', descricao='MEDICO CLINICO')],
         esperado='CBO inválido (Q010) + Sem CBO no Tasy (Q005) + D005 (225125)')
    caso('C21', 'Mesmo CBO repetido com especialidade diferente',
         [t('TEREZA FICTICIA ARAUJO', c(840004021), k(4021), '225125', especialidade='CLINICA MEDICA'),
          t('TEREZA FICTICIA ARAUJO', c(840004021), k(4021), '225125', especialidade='GERIATRIA')],
         [t('TEREZA FICTICIA ARAUJO', c(840004021), k(4021), '225125', descricao='MEDICO CLINICO')],
         esperado='Mesmo CBO com dados diferentes (Q008)')
    caso('C22', 'Funcionário? = N continua na comparação',
         [t('URSULA FICTICIA PENA', c(840004022), k(4022), '223505', funcionario='N')],
         [t('URSULA FICTICIA PENA', c(840004022), k(4022), '223505', descricao='ENFERMEIRO')],
         esperado='Sem divergência (Funcionário = N não exclui)')
    return casos


def gerar_checa(pasta):
    casos = cenarios_checa()
    wb = Workbook()
    ws = wb.active
    ws.title = 'Planilha1'
    ws.append(CAB_TASY)
    codigos = {}
    for _cod, _d, tasy, _cn, _adc, _e in casos:
        for d in tasy:
            cd = d.get('cd') or codigos.setdefault(d['nome'], 1000 + len(codigos))
            ws.append([cd, d['nome'], d['cpf'], None, VAZIO, VAZIO, d['cns'], d['cbo'],
                       d.get('especialidade', VAZIO), d.get('vinculo', 'ESTATUTARIO'),
                       COD_TASY_HIJPII, SIGLA_HIJPII, d.get('funcionario', 'S')])
    for cel in ws[1]:
        cel.font, cel.fill = CABECALHO, FUNDO
    wb.save(pasta / 'Tasy Profissionais HIJPII (TESTE).xlsx')

    def planilha_cnes(nome_arquivo, titulo, linhas):
        wb = Workbook()
        ws = wb.active
        ws.title = 'Planilha1'
        ws.append([titulo])
        ws.append(['CPF', 'CNS', 'NOME', 'CBO', 'DESCRICAO CBO'])
        for d in linhas:
            ws.append([d['cpf'], d['cns'], d['nome'], d['cbo'], d.get('descricao', 'OCUPACAO')])
        for cel in ws[2]:
            cel.font, cel.fill = CABECALHO, FUNDO
        wb.save(pasta / nome_arquivo)

    todas_cnes = [d for caso in casos for d in caso[3]]
    planilha_cnes('CNES Profissionais HIJPII (TESTE).xlsx',
                  f'CNES : {CNES_HIJPII} - HOSPITAL INFANTIL JOAO PAULO II', todas_cnes)
    planilha_cnes('CNES Profissionais HAC - UNIDADE ERRADA (TESTE).xlsx',
                  'CNES : 0026964 - HOSPITAL ALBERTO CAVALCANTI', todas_cnes[:5])

    wb = Workbook()
    ws = wb.active
    ws.title = 'ADC'
    ws.append(CAB_TASY)
    for _cod, _d, _t, _cn, adc, _e in casos:
        for i, d in enumerate(adc):
            ws.append([9000 + i, d['nome'], d['cpf'], None, VAZIO, VAZIO, d['cns'], d['cbo'], VAZIO,
                       'ESTATUTARIO', 1, 'ADC', 'S'])
    ws.append([9100, 'WAGNER FICTICIO CENTRAL', cpf(840004099), None, VAZIO, VAZIO, cns(4099), '252105',
               VAZIO, 'ESTATUTARIO', 1, 'ADC', 'S'])
    for cel in ws[1]:
        cel.font, cel.fill = CABECALHO, FUNDO
    wb.save(pasta / 'Profissionais ADC (TESTE).xlsx')

    salvar_planilha(pasta / 'CBO_assistencial (TESTE).xlsx', [
        ['CBO', 'DESCRICAO', 'FHEMIG ASSISTENCIAL'],
        ['225125', 'MEDICO CLINICO', 'SIM'], ['225124', 'MEDICO PEDIATRA', 'SIM'],
        ['2231F9', 'MEDICO RESIDENTE', 'SIM'], ['223505', 'ENFERMEIRO', 'SIM'],
        ['223510', 'ENFERMEIRO AUDITOR', 'NAO'], ['225150', 'MEDICO EM MEDICINA INTENSIVA', 'SIM'],
        ['322205', 'TECNICO DE ENFERMAGEM', 'SIM'], ['515105', 'AGENTE COMUNITARIO DE SAUDE', 'NAO'],
        ['252105', 'ADMINISTRADOR', 'NAO'],
    ], titulo_aba='CBO GERAL', larguras=[10, 36, 22])
    return casos


# ===========================================================================
# Gabaritos
# ===========================================================================
def escrever_gabarito(caminho, titulo, cabecalho, linhas, rodape=''):
    with open(caminho, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f, delimiter=';')
        w.writerow([titulo])
        w.writerow(cabecalho)
        w.writerows(linhas)
        if rodape:
            w.writerow([])
            w.writerow([rodape])


def main():
    for pasta in (PASTA_HOSP, PASTA_AMB, PASTA_CHECA):
        pasta.mkdir(parents=True, exist_ok=True)
    desc, cids = descricoes_sigtap()

    aihs = cenarios_hospitalar()
    gerar_txt_sisaih01(aihs, PASTA_HOSP / f'SISAIH01_{UNIDADE_HOSP}_{COMP_HOSP}_TESTE.txt')
    gerar_pdf_espelho(aihs, PASTA_HOSP / f'Espelho_AIH_{UNIDADE_HOSP}_{COMP_HOSP}_TESTE.pdf', desc, cids)
    gerar_bases_hospitalar(PASTA_HOSP)
    escrever_gabarito(
        PASTA_HOSP / 'GABARITO_Hospitalar.csv', 'Gabarito - Fatura Fhemig Hospitalar (TXT e PDF trazem as mesmas AIHs)',
        ['Caso', 'AIH', 'Cenario', 'Alertas esperados'],
        [[a['caso'], f"{a['aih'][:12]}-{a['aih'][12]}", a['titulo'], ' | '.join(a['esperado'])] for a in aihs])

    esperado_amb = gerar_txt_bpa(PASTA_AMB)
    gerar_bases_ambulatorial(PASTA_AMB)
    escrever_gabarito(
        PASTA_AMB / 'GABARITO_Ambulatorial.csv', f'Gabarito - Fatura Fhemig Ambulatorial (BPA_HRBJA_{COMP_AMB}_TESTE.txt)',
        ['Caso', 'Tipo', 'Procedimento', 'Alertas esperados'], [list(e) for e in esperado_amb],
        'O arquivo _CABECALHO_INCONSISTENTE traz as mesmas linhas validas (A01-A16) com cabecalho errado: '
        'deve gerar avisos de quantidade de linhas, de folhas e de campo de controle.')

    casos = gerar_checa(PASTA_CHECA)
    escrever_gabarito(
        PASTA_CHECA / 'GABARITO_ChecaProfissionais.csv', 'Gabarito - ChecaProfissionais (Tasy x CNES HIJPII)',
        ['Caso', 'Cenario', 'Resultado esperado'], [[c[0], c[1], c[5]] for c in casos],
        'O arquivo CNES ... HAC - UNIDADE ERRADA deve interromper o processamento com "Tasy e CNES de unidades diferentes" (E002).')
    print('Arquivos gerados em', RAIZ)


if __name__ == '__main__':
    main()
