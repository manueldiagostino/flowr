import { Feature, FeatureInfo, Query } from '../feature'
import * as xpath from 'xpath-ts2'
import { EvalOptions } from 'xpath-ts2/src/parse-api'
import { append } from '../../output'

export type SinglePackageInfo = string

export interface UsedPackageInfo extends FeatureInfo {
  library:              number
  require:              number
  loadNamespace:        number
  requireNamespace:     number
  attachNamespace:      number
  withinApply:          number
  '::':                 number
  ':::':                number
  /** just contains all occurrences where it is impossible to statically determine which package is loaded */
  '<loadedByVariable>': number
}

const initialUsedPackageInfos = (): UsedPackageInfo => ({
  library:              0,
  require:              0,
  loadNamespace:        0,
  requireNamespace:     0,
  attachNamespace:      0,
  withinApply:          0,
  '::':                 0,
  ':::':                0,
  '<loadedByVariable>': 0
})


// based on the extraction routine of lintr search for function calls which are not character-loads (we can not trace those...)
const withinApply: Query = xpath.parse(`
  //SYMBOL_FUNCTION_CALL[contains(.,"apply")]/../..
    //SYMBOL[text()='require' or text()='library' or text()='loadNamespace' or text()='requireNamespace' or text()='attachNamespace']
    /../..
`)

// horribles ways O found exploratively like loading within `sapply`
const libraryOrRequire: Query = xpath.parse(`
  //SYMBOL_FUNCTION_CALL[text() = $variable]
    /parent::expr
    /parent::expr[
      expr[2][STR_CONST]
      or (
        expr[2][SYMBOL]
        and not(
          SYMBOL_SUB[text() = 'character.only']
          /following-sibling::expr[1]
          /NUM_CONST[text() = 'TRUE' or text() = 'T']
        )
      )
    ]/OP-LEFT-PAREN[1]/following-sibling::expr[1][SYMBOL | STR_CONST]
`)

// there is no except in xpath 1.0?
const packageLoadedWithVariableLoadRequire: Query = xpath.parse(`
    //SYMBOL_FUNCTION_CALL[text() = 'library' or text() = 'require']
    /parent::expr
    /parent::expr[
        expr[2][SYMBOL]
        and (
          SYMBOL_SUB[text() = 'character.only']
          /following-sibling::expr[1]
          /NUM_CONST[text() = 'TRUE' or text() = 'T']
        )
    ]/OP-LEFT-PAREN[1]/following-sibling::expr[1][SYMBOL | STR_CONST]
`)

const packageLoadedWithVariableNamespaces: Query = xpath.parse(`
  //SYMBOL_FUNCTION_CALL[text() = 'loadNamespace' or text() = 'requireNamespace' or text() = 'attachNamespace']/../following-sibling::expr[1][SYMBOL]
`)

const queryForFunctionCall: Query = xpath.parse(`
  //SYMBOL_FUNCTION_CALL[text() = $variable]/../following-sibling::expr[1][STR_CONST]
`)

// otherwise, the parser seems to fail
const queryForNsAccess: Query = xpath.parse(`
  //NS_GET[text() = $variable]/../SYMBOL_PACKAGE[1]
  |
  //NS_GET_INT[text() = $variable]/../SYMBOL_PACKAGE[1]
`)

const queries: { types: readonly (keyof UsedPackageInfo)[], query: { select(options?: EvalOptions): Node[] } }[] = [
  {
    types: [ 'library', 'require' ],
    query: libraryOrRequire
  },
  {
    types: [ 'loadNamespace', 'requireNamespace', 'attachNamespace' ],
    query: queryForFunctionCall
  },
  {
    types: [ '::', ':::' ],
    query: queryForNsAccess
  }
]

export const usedPackages: Feature<UsedPackageInfo> = {
  name:        'Used Packages',
  description: 'All the packages used in the code',

  process(existing: UsedPackageInfo, input: Document, filepath: string | undefined): UsedPackageInfo {
    // we will unify in the end, so we can count, group etc. but we do not re-count multiple packages in the same file
    for(const q of queries) {
      for(const fn of q.types) {
        const nodes = q.query.select({ node: input, variables: { variable: fn } })
        existing[fn] += nodes.length
        append(this.name, fn, nodes, filepath, true)
      }
    }

    const nodesForVariableLoad = [
      ...packageLoadedWithVariableLoadRequire.select({ node: input }),
      ...packageLoadedWithVariableNamespaces.select({ node: input })
    ]
    existing['<loadedByVariable>'] += nodesForVariableLoad.length
    // should not be unique as variables may be repeated, and we have no idea
    append(this.name, '<loadedByVariable>', nodesForVariableLoad, filepath)

    const withinApplyNodes = withinApply.select({ node: input })
    existing.withinApply += withinApplyNodes.length
    append(this.name, 'withinApply', withinApplyNodes, filepath)

    return existing
  },

  initialValue: initialUsedPackageInfos
}




