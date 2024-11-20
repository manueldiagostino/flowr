import type { NoInfo } from '../r-bridge/lang-4.x/ast/model/model';
import type { Visitor } from './normalized-ast-visitor';

export interface AINode<Info = NoInfo> {
	accept(visitor: Visitor<Info>): void;
}
