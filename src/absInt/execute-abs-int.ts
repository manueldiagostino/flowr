import { NormalizedAst } from "../r-bridge/lang-4.x/ast/model/processing/decorate";

export interface AbsIntResult {

    result : string

}

export function executeAbsInt (normalizeAst : NormalizedAst, ) : Readonly<AbsIntResult> {

    return {
        result : "result AbsInt"
    }

} 