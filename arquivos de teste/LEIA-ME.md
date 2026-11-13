# Arquivos de teste: dados simulados

Massa de teste para o Fatura Fhemig Hospitalar 14.3, o Fatura Fhemig Ambulatorial 1.0 e o ChecaProfissionais 2.0. **Todos os dados são inventados**: pacientes, profissionais, CPFs, CNS, AIHs e prontuários. Os nomes levam "FICTICIO(A)". CPF e CNS têm dígito verificador válido apenas para passar pela checagem de formato.

Os formatos vêm só do código dos backends. Nenhum arquivo de produção foi aberto. Os procedimentos são reais, tirados da tabela SIGTAP pública, e foram escolhidos para disparar alertas conhecidos.

Todos os cenários foram executados nos backends reais em 12/11/2026, e o resultado bateu com os gabaritos.

## teste Hospitalar (unidade HJXXIII, competência 09/2026)

| Arquivo | Uso |
| --- | --- |
| `SISAIH01_HJXXIII_202609_TESTE.txt` | Entrada TXT (posicional SISAIH01, 1800 colunas) |
| `Espelho_AIH_HJXXIII_202609_TESTE.pdf` | Entrada PDF (espelho com texto selecionável), com as mesmas AIHs do TXT |
| `Serviço e Classificação HJXXIII (TESTE).xlsx` | Base da unidade: o serviço 131-002 está faltando e o 126-001 só existe como terceiro |
| `Habilitações HJXXIII (TESTE).xlsx` | Base da unidade: a habilitação 2606 (UTI pediátrica) está faltando |
| `Profissionais HJXXIII (TESTE).xlsx` | CNS, CPF e CBO dos profissionais fictícios |
| `GABARITO_Hospitalar.csv` | Alerta esperado por AIH (H01 a H14) |

São 14 AIHs, uma para cada alerta ativo, além de reinternação em menos de 72h, AIH com registro de continuação (tipo 03), profissional identificado por CPF e a exceção do 2º executante.

## teste Ambulatorial (unidade HRBJA, CNES 3698548, competência 10/2026)

| Arquivo | Uso |
| --- | --- |
| `BPA_HRBJA_202610_TESTE.txt` | Entrada BPA com cabeçalho correto, 4 BPA-C, 12 BPA-I e 2 linhas inválidas |
| `BPA_HRBJA_202610_CABECALHO_INCONSISTENTE.txt` | Mesmas linhas válidas, mas o cabeçalho tem contagem e controle errados (testa os avisos gerais) |
| `Profissionais`, `Carga Horária`, `Serviço Classificação`, `Habilitações` `HRBJA (TESTE).xlsx` | As quatro bases da unidade. A habilitação 1102 venceu em 06/2026 e o serviço 115-011 está faltando |
| `GABARITO_Ambulatorial.csv` | Alertas esperados por linha (A01 a A18) |

A competência 10/2026 é a mesma do `SIGTAP102026.xlsx` que acompanha o pacote ambulatorial. Assim não aparece o aviso de SIGTAP de outra competência.

## teste ChecaProfissionais (unidade HIJPII)

| Arquivo | Uso |
| --- | --- |
| `Tasy Profissionais HIJPII (TESTE).xlsx` | Relatório Tasy (código de estabelecimento 8) |
| `CNES Profissionais HIJPII (TESTE).xlsx` | Planilha CNES (título `CNES : 0026948`) |
| `CNES Profissionais HAC - UNIDADE ERRADA (TESTE).xlsx` | Deve interromper com E002 (unidades diferentes) |
| `Profissionais ADC (TESTE).xlsx` | Base ADC de teste (selecione no lugar da padrão) |
| `CBO_assistencial (TESTE).xlsx` | Base de CBO assistencial de teste |
| `GABARITO_ChecaProfissionais.csv` | Resultado esperado por caso (C01 a C22) |

## Regenerar

```powershell
& "..\Fatura Fhemig 14.3\_internal\python.exe" .\gerar_arquivos_teste.py
```

O script usa o Python portátil do Hospitalar, que já traz openpyxl e PyMuPDF. Ele sobrescreve os arquivos e o resultado é sempre o mesmo.
