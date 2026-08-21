/**
 * AST (Abstract Syntax Tree) node definitions.
 */

/**
 * AST Node types for the parsed program.
 */
export type ASTNode =
  | ProgramNode
  | DefineInstructionNode
  | ExecutionBlockNode
  | IfNode
  | WhileNode
  | IterateNode
  | InstructionCallNode
  | BlockNode;

export interface ProgramNode {
  type: "program";
  definitions: DefineInstructionNode[];
  execution: ExecutionBlockNode;
}

export interface DefineInstructionNode {
  type: "define";
  name: string;
  body: BlockNode;
  line: number;
}

export interface ExecutionBlockNode {
  type: "execution";
  statements: ASTNode[];
}

export interface BlockNode {
  type: "block";
  statements: ASTNode[];
}

export interface IfNode {
  type: "if";
  condition: string;
  thenBranch: BlockNode;
  elseBranch?: BlockNode;
  line: number;
}

export interface WhileNode {
  type: "while";
  condition: string;
  body: BlockNode;
  line: number;
}

export interface IterateNode {
  type: "iterate";
  count: number;
  body: BlockNode;
  line: number;
}

export interface InstructionCallNode {
  type: "call";
  name: string;
  line: number;
}
