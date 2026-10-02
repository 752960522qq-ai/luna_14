import {parse} from '@babel/parser';

// AST ranges handle comments, strings, regexes and nested template literals.
export function sourceIndex(source){
 const ast=parse(source,{sourceType:'module'}),functions=new Map(),declarations=new Map();
 for(const node of ast.program.body){
  if(node.type==='FunctionDeclaration')functions.set(node.id.name,source.slice(node.start,node.end));
  if(node.type==='VariableDeclaration')for(const item of node.declarations){
   if(item.id.type!=='Identifier')continue;
   declarations.set(item.id.name,node.kind+' '+source.slice(item.start,item.end)+';');
  }
 }
 const lookup=(table,name)=>{if(!table.has(name))throw new Error('Missing source binding: '+name);return table.get(name)};
 return{function:name=>lookup(functions,name),declaration:name=>lookup(declarations,name),ast};
}
