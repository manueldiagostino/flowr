import type { NoInfo } from '../../r-bridge/lang-4.x/ast/model/model';
import type { RAccess } from '../../r-bridge/lang-4.x/ast/model/nodes/r-access';
import type { RArgument } from '../../r-bridge/lang-4.x/ast/model/nodes/r-argument';
import type { RBreak } from '../../r-bridge/lang-4.x/ast/model/nodes/r-break';
import type { RComment } from '../../r-bridge/lang-4.x/ast/model/nodes/r-comment';
import type { RExpressionList } from '../../r-bridge/lang-4.x/ast/model/nodes/r-expression-list';
import type { RForLoop } from '../../r-bridge/lang-4.x/ast/model/nodes/r-for-loop';
import type { RFunctionCall } from '../../r-bridge/lang-4.x/ast/model/nodes/r-function-call';
import type { RFunctionDefinition } from '../../r-bridge/lang-4.x/ast/model/nodes/r-function-definition';
import type { RIfThenElse } from '../../r-bridge/lang-4.x/ast/model/nodes/r-if-then-else';
import type { RLineDirective } from '../../r-bridge/lang-4.x/ast/model/nodes/r-line-directive';
import type { RLogical } from '../../r-bridge/lang-4.x/ast/model/nodes/r-logical';
import type { RNext } from '../../r-bridge/lang-4.x/ast/model/nodes/r-next';
import type { RParameter } from '../../r-bridge/lang-4.x/ast/model/nodes/r-parameter';
import type { RPipe } from '../../r-bridge/lang-4.x/ast/model/nodes/r-pipe';
import type { RRepeatLoop } from '../../r-bridge/lang-4.x/ast/model/nodes/r-repeat-loop';
import type { RString } from '../../r-bridge/lang-4.x/ast/model/nodes/r-string';
import type { RSymbol } from '../../r-bridge/lang-4.x/ast/model/nodes/r-symbol';
import type { RUnaryOp } from '../../r-bridge/lang-4.x/ast/model/nodes/r-unary-op';
import type { RWhileLoop } from '../../r-bridge/lang-4.x/ast/model/nodes/r-while-loop';
import type { AINode } from './ai-node';
import type { Visitor } from '../normalized-ast-visitor';

export class AIString implements AINode<NoInfo> {
	node: RString;

	constructor(rString: RString) {
		this.node = rString;
	}

	accept(visitor: Visitor<NoInfo>): void {
		if(visitor.visitString) {
			visitor.visitString(this.node);
		} else {
			throw new Error('AIString::accept Visitor::visitString not defined');
		}
	}
}

export class AILogical implements AINode<NoInfo> {
	node: RLogical;

	constructor(rLogical: RLogical) {
		this.node = rLogical;
	}

	accept(visitor: Visitor<NoInfo>): void {
		if(visitor.visitLogical) {
			visitor.visitLogical(this.node);
		} else {
			throw new Error('AILogical::accept Visitor::visitLogical not defined');
		}
	}
}

export class AISymbol implements AINode<NoInfo> {
	node: RSymbol;

	constructor(rSymbol: RSymbol) {
		this.node = rSymbol;
	}

	accept(visitor: Visitor<NoInfo>): void {
		if(visitor.visitSymbol) {
			visitor.visitSymbol(this.node);
		} else {
			throw new Error('AISymbol::accept Visitor::visitSymbol not defined');
		}
	}
}

export class AIAccess implements AINode<NoInfo> {
	node: RAccess;

	constructor(rAccess: RAccess) {
		this.node = rAccess;
	}

	accept(visitor: Visitor<NoInfo>): void {
		if(visitor.visitAccess) {
			visitor.visitAccess(this.node);
		} else {
			throw new Error('AIAccess::accept Visitor::visitAccess not defined');
		}
	}
}

export class AIPipe implements AINode<NoInfo> {
	node: RPipe;

	constructor(rPipe: RPipe) {
		this.node = rPipe;
	}

	accept(visitor: Visitor<NoInfo>): void {
		if(visitor.visitPipe) {
			visitor.visitPipe(this.node);
		} else {
			throw new Error('AIPipe::accept Visitor::visitPipe not defined');
		}
	}
}

export class AIUnaryOp implements AINode<NoInfo> {
	node: RUnaryOp;

	constructor(rUnaryOp: RUnaryOp) {
		this.node = rUnaryOp;
	}

	accept(visitor: Visitor<NoInfo>): void {
		if(visitor.visitUnaryOp) {
			visitor.visitUnaryOp(this.node);
		} else {
			throw new Error('AIUnaryOp::accept Visitor::visitUnaryOp not defined');
		}
	}
}

export class AIForLoop implements AINode<NoInfo> {
	node: RForLoop;

	constructor(rForLoop: RForLoop) {
		this.node = rForLoop;
	}

	accept(visitor: Visitor<NoInfo>): void {
		if(visitor.visitFor) {
			visitor.visitFor(this.node);
		} else {
			throw new Error('AIForLoop::accept Visitor::visitFor not defined');
		}
	}
}

export class AIWhileLoop implements AINode<NoInfo> {
	node: RWhileLoop;

	constructor(rWhileLoop: RWhileLoop) {
		this.node = rWhileLoop;
	}

	accept(visitor: Visitor<NoInfo>): void {
		if(visitor.visitWhile) {
			visitor.visitWhile(this.node);
		} else {
			throw new Error('AIWhileLoop::accept Visitor::visitWhile not defined');
		}
	}
}

export class AIRepeatLoop implements AINode<NoInfo> {
	node: RRepeatLoop;

	constructor(rRepeatLoop: RRepeatLoop) {
		this.node = rRepeatLoop;
	}

	accept(visitor: Visitor<NoInfo>): void {
		if(visitor.visitRepeat) {
			visitor.visitRepeat(this.node);
		} else {
			throw new Error('AIRepeatLoop::accept Visitor::visitRepeat not defined');
		}
	}
}

export class AIBreak implements AINode<NoInfo> {
	node: RBreak;

	constructor(rBreak: RBreak) {
		this.node = rBreak;
	}

	accept(visitor: Visitor<NoInfo>): void {
		if(visitor.visitBreak) {
			visitor.visitBreak(this.node);
		} else {
			throw new Error('AIBreak::accept Visitor::visitBreak not defined');
		}
	}
}

export class AINext implements AINode<NoInfo> {
	node: RNext;

	constructor(rNext: RNext) {
		this.node = rNext;
	}

	accept(visitor: Visitor<NoInfo>): void {
		if(visitor.visitNext) {
			visitor.visitNext(this.node);
		} else {
			throw new Error('AINext::accept Visitor::visitNext not defined');
		}
	}
}

export class AIComment implements AINode<NoInfo> {
	node: RComment;

	constructor(rComment: RComment) {
		this.node = rComment;
	}

	accept(visitor: Visitor<NoInfo>): void {
		if(visitor.visitComment) {
			visitor.visitComment(this.node);
		} else {
			throw new Error('AIComment::accept Visitor::visitComment not defined');
		}
	}
}

export class AILineDirective implements AINode<NoInfo> {
	node: RLineDirective;

	constructor(rLineDirective: RLineDirective) {
		this.node = rLineDirective;
	}

	accept(visitor: Visitor<NoInfo>): void {
		if(visitor.visitLineDirective) {
			visitor.visitLineDirective(this.node);
		} else {
			throw new Error('AILineDirective::accept Visitor::visitLineDirective not defined');
		}
	}
}

export class AIIfThenElse implements AINode<NoInfo> {
	node: RIfThenElse;

	constructor(rIfThenElse: RIfThenElse) {
		this.node = rIfThenElse;
	}

	accept(visitor: Visitor<NoInfo>): void {
		if(visitor.visitIfThenElse) {
			visitor.visitIfThenElse(this.node);
		} else {
			throw new Error('AIIfThenElse::accept Visitor::visitIfThenElse not defined');
		}
	}
}

export class AIExpressionList implements AINode<NoInfo> {
	node: RExpressionList;

	constructor(rExpressionList: RExpressionList) {
		this.node = rExpressionList;
	}

	accept(visitor: Visitor<NoInfo>): void {
		if(visitor.visitExprList) {
			visitor.visitExprList(this.node);
		} else {
			throw new Error('AIExpressionList::accept Visitor::visitExprList not defined');
		}
	}
}

export class AIFunctionDefinition implements AINode<NoInfo> {
	node: RFunctionDefinition;

	constructor(rFunctionDefinition: RFunctionDefinition) {
		this.node = rFunctionDefinition;
	}

	accept(visitor: Visitor<NoInfo>): void {
		if(visitor.visitFunctionDefinition) {
			visitor.visitFunctionDefinition(this.node);
		} else {
			throw new Error('AIFunctionDefinition::accept Visitor::visitFunctionDefinition not defined');
		}
	}
}

export class AIFunctionCall implements AINode<NoInfo> {
	node: RFunctionCall;

	constructor(rFunctionCall: RFunctionCall) {
		this.node = rFunctionCall;
	}

	accept(visitor: Visitor<NoInfo>): void {
		if(visitor.visitFunctionCall) {
			visitor.visitFunctionCall(this.node);
		} else {
			throw new Error('AIFunctionCall::accept Visitor::visitFunctionCall not defined');
		}
	}
}

export class AIArgument implements AINode<NoInfo> {
	node: RArgument;

	constructor(rArgument: RArgument) {
		this.node = rArgument;
	}

	accept(visitor: Visitor<NoInfo>): void {
		if(visitor.visitArgument) {
			visitor.visitArgument(this.node);
		} else {
			throw new Error('AIArgument::accept Visitor::visitArgument not defined');
		}
	}
}

export class AIParameter implements AINode<NoInfo> {
	node: RParameter;

	constructor(rParameter: RParameter) {
		this.node = rParameter;
	}

	accept(visitor: Visitor<NoInfo>): void {
		if(visitor.visitParameter) {
			visitor.visitParameter(this.node);
		} else {
			throw new Error('AIParameter::accept Visitor::visitParameter not defined');
		}
	}
}
