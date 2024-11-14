import { RType } from "../../../../r-bridge/lang-4.x/ast/model/type";

export interface BaseNonRelationalValueDomain<T> {

    evalNumber(node: RType.Number) :  T;
    evalBinaryOp(node: RType.BinaryOp) :  T;

}