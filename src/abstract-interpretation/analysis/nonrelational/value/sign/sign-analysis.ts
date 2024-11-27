import { NonRelationalValueAnalysis } from '../analysis';
import { NonRelationalValueStateAbstractDomain } from '../non-relational-value-state-abstract-domain';
import { Sign } from './sign-domain';

export class SignAnalysis extends NonRelationalValueAnalysis<
	Sign,
	NonRelationalValueStateAbstractDomain<Sign>> {

	constructor() {
		super(Sign.getInstance(), new NonRelationalValueStateAbstractDomain(Sign.getInstance()));
	}
}
