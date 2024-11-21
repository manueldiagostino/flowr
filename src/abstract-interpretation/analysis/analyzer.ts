import { RNode } from '../r-bridge/lang-4.x/ast/model/model';
import type { NormalizedAst, ParentInformation } from '../r-bridge/lang-4.x/ast/model/processing/decorate';
import { AbstractDomain } from './abstract-domain';
import { Lattice } from './lattice';
import { LatticeElement } from './lattice-element';

export interface IAnalyzer <T extends AbstractDomain<Lattice<LatticeElement>, ConcreteElement>, ConcreteElement> {

    abstractDomain:                                         T;  
    normalizedAst:                                          NormalizedAst | undefined;
    analyze():                                              void;
    getConcretElement(latticeElement : LatticeElement):     ConcreteElement;

}

export class Analyzer<T extends AbstractDomain<Lattice<LatticeElement>, ConcreteElement>, ConcreteElement> implements IAnalyzer<T, ConcreteElement> {
    
    readonly abstractDomain: T;
    readonly normalizedAst: NormalizedAst<ParentInformation, RNode<ParentInformation>>;
    
    constructor (abstractDomain : T, normalizedAst: NormalizedAst<ParentInformation, RNode<ParentInformation>>) {
        this.normalizedAst = normalizedAst;
        this.abstractDomain = abstractDomain;
    }

    analyze(): void {
        throw new Error('Method not implemented.');
    }

    getConcretElement(latticeElement : LatticeElement): ConcreteElement {
        return this.abstractDomain.getConcrete(latticeElement);
    }

}