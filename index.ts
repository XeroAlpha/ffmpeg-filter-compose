export type FilterArgumentValue = string | number;
export type FilterArgument = FilterArgumentValue | Record<string, FilterArgumentValue | FileArgument> | FilterArgumentValue[];
export type FilterFunction = (...args: FilterArgument[]) => Filter;
interface IterableStreamLikeArray<T> extends Iterable<T> {
  [index: number]: T;
  toArray(count: number): T[];
}
export type InputFileStreamMap = IterableStreamLikeArray<Pipe> & Record<string, Pipe>;
export type FilterMap = Record<string, FilterFunction>;

export interface FilterComplexContext {
  readonly from: (...labels: Pipe[]) => ChainNode;
  readonly pipe: (name?: string) => Pipe;
  readonly recycle: (...labels: (Pipe | null | undefined)[]) => void;
  readonly split: (pipe: Pipe) => Iterable<Pipe>;
  readonly input: Readonly<IterableStreamLikeArray<Readonly<InputFileStreamMap>>>;
  readonly filter: Readonly<FilterMap>;
  readonly fileArgument: (path: string) => FileArgument;
}

export type PipeMediaType = 'unknown' | 'video' | 'audio' | 'data' | 'subtitle' | 'attachment' | 'nb';

export class Pipe {
  /** @internal */
  name: string;
  /** @internal */
  hintText?: string;
  /** @internal */
  fixed: boolean;
  /** @internal */
  mediaType: PipeMediaType = 'unknown';
  /** @internal */
  boundInput = false;
  /** @internal */
  boundOutput = false;
  /** @internal */
  shared = false;

  /** @internal */
  constructor(name: string, fixed?: boolean) {
    this.name = name;
    this.fixed = fixed ?? false;
  }

  as(newName: string) {
    if (this.fixed) {
      throw new Error(`Cannot rename a fixed pipe: ${this.inspect()}`);
    }
    this.name = newName;
    this.fixed = true;
    return this;
  }

  mark(mediaType: PipeMediaType) {
    if (this.mediaType !== 'unknown') {
      throw new Error(`Cannot mark this pipe as ${mediaType}, since it has been marked as ${this.mediaType}`);
    }
    this.mediaType = mediaType;
    return this;
  }

  hint(hint: string) {
    this.hintText = hint;
    return this;
  }

  setBoundInput() {
    if (this.boundInput) {
      throw new Error(`Pipe ${this.inspect()} has been bound to output`);
    }
    this.boundInput = true;
    return this;
  }

  setBoundOutput() {
    if (this.boundOutput) {
      throw new Error(`Pipe ${this.inspect()} has been bound to input, please use split or asplit filter`);
    }
    if (!this.shared) {
      this.boundOutput = true;
    }
    return this;
  }

  toString() {
    return `[${this.name}]`;
  }

  /** @internal */
  inspect() {
    if (this.hintText) {
      return `[${this.name}](${this.hintText})`;
    }
    return `[${this.name}]`;
  }
}

const SPREAD_OPERATOR_DETECT_THRESOLD = 128;
const IterableStreamLikeArrayProto: IterableStreamLikeArray<unknown> = {
  toArray(count) {
    const arr = new Array(count);
    for (let i = 0; i < count; i++) {
      arr[i] = this[i];
    }
    return arr;
  },
  *[Symbol.iterator]() {
    for (let i = 0; i < SPREAD_OPERATOR_DETECT_THRESOLD; i++) {
      yield this[i];
    }
    throw new Error(`Do not use spread operator on stream-like array.`);
  },
};

function createCachedGetterProxy<T extends object>(target: T, getter: (p: Exclude<keyof T, symbol>) => T[typeof p]): T {
  const cache: Record<string | symbol, T[keyof T]> = {};
  return new Proxy(target, {
    get(target, p) {
      if (typeof p === 'symbol' || p in target) {
        return target[p as keyof T];
      }
      if (p in cache) {
        return cache[p];
      }
      const value = getter(p as Exclude<keyof T, symbol>);
      cache[p] = value;
      return value;
    },
  });
}

const MediaTypePrefixMap: [string, PipeMediaType][] = [
  ['v', 'video'],
  ['V', 'video'],
  ['a', 'audio'],
  ['s', 'subtitle'],
  ['d', 'data'],
  ['t', 'attachment'],
];

const InputProxy = createCachedGetterProxy<IterableStreamLikeArray<InputFileStreamMap>>(
  Object.create(IterableStreamLikeArrayProto),
  (inputIndex) => {
    const streamProxy = createCachedGetterProxy<InputFileStreamMap>(
      Object.create(IterableStreamLikeArrayProto),
      (streamSpecifier) => {
        const pipe = new Pipe(`${inputIndex}:${streamSpecifier}`, true);
        pipe.setBoundInput();
        pipe.shared = true;
        if (typeof streamSpecifier === 'string') {
          const mediaType = MediaTypePrefixMap.find(
            ([prefix]) => streamSpecifier === prefix || streamSpecifier.startsWith(`${prefix}:`)
          );
          if (mediaType) {
            pipe.mark(mediaType[1]);
          }
        }
        return pipe;
      }
    );
    return streamProxy;
  }
);

export class FileArgument {
  path: string;

  /** @internal */
  constructor(path: string) {
    this.path = path;
  }
}

const FileArgumentFactory = (path: string) => new FileArgument(path);

export function escapeFilterArgumentValue(value: FilterArgumentValue): string {
  if (typeof value === 'string') {
    return value.replace(/[\\:']/g, '\\$&');
  }
  return String(value);
}

function parseFilterArguments(args: FilterArgument[]): string {
  if (args.length === 1 && typeof args[0] === 'string') {
    return args[0];
  }
  const parts: string[] = [];
  for (const arg of args) {
    if (Array.isArray(arg)) {
      parts.push(...arg.map((e) => escapeFilterArgumentValue(e)));
    } else if (typeof arg === 'object') {
      parts.push(
        ...Object.entries(arg).map(([k, v]) => {
          if (v instanceof FileArgument) {
            return `/${k}=${escapeFilterArgumentValue(v.path)}`;
          }
          return `${k}=${escapeFilterArgumentValue(v)}`;
        })
      );
    } else {
      parts.push(escapeFilterArgumentValue(arg));
    }
  }
  return parts.join(':');
}

export function escapeFilterArgument(arg: string, quote?: boolean): string {
  if (quote) {
    const quoteParts = arg.split("'");
    return quoteParts
      .filter((e) => e !== '')
      .map((e) => `'${e}'`)
      .join("\\'");
  }
  return arg.replace(/[\\'[\],;]/g, '\\$&');
}

export class Filter {
  name: string;
  arguments?: string;

  /** @internal */
  constructor(name: string, args: FilterArgument[]) {
    this.name = name;
    if (args.length > 0) {
      this.arguments = parseFilterArguments(args);
    }
  }

  setArguments(...args: FilterArgument[]) {
    if (args.length > 0) {
      this.arguments = parseFilterArguments(args);
    } else {
      this.arguments = undefined;
    }
  }

  toString() {
    if (this.arguments !== undefined) {
      return `${this.name}=${escapeFilterArgument(this.arguments, true)}`;
    }
    return this.name;
  }
}

const FilterProxy = createCachedGetterProxy<Record<string, FilterFunction>>({}, (filterName) => {
  return (...args: FilterArgument[]) => {
    return new Filter(filterName as string, args);
  };
});
const NullFilterMap: Partial<Record<PipeMediaType, Filter>> = {
  video: FilterProxy.null(),
  audio: FilterProxy.anull(),
};
const NullSinkMap: Partial<Record<PipeMediaType, Filter>> = {
  video: FilterProxy.nullsink(),
  audio: FilterProxy.anullsink(),
};
const SplitMap: Partial<Record<PipeMediaType, FilterFunction>> = {
  video: FilterProxy.split,
  audio: FilterProxy.asplit,
};

export class ChainNode implements Iterable<Pipe> {
  /** @internal */
  helper: FilterComplexHelper;
  /** @internal */
  source: Pipe[];
  /** @internal */
  filter: Filter | null;
  /** @internal */
  destination: Pipe[];
  /** @internal */
  prev: ChainNode | null;
  /** @internal */
  next: ChainNode | null;

  /** @internal */
  constructor(helper: FilterComplexHelper, source: Pipe[]) {
    this.helper = helper;
    this.source = source;
    this.filter = null;
    this.destination = [];
    this.prev = null;
    this.next = null;
    source.forEach((p) => this.helper.checkPipe(p));
  }

  pipe(filterOrFunc: Filter | FilterFunction) {
    if (this.next) {
      throw new Error(`This chain has been linked to another filter`);
    }
    const filter = typeof filterOrFunc === 'function' ? filterOrFunc() : filterOrFunc;
    if (!this.filter) {
      this.filter = filter;
      this.source.forEach((p) => p.setBoundOutput());
      return this;
    }
    const next = new ChainNode(this.helper, []);
    next.pipe(filter);
    this.next = next;
    next.prev = this;
    return next;
  }

  fork(connectedPipeCount: number) {
    if (this.next) {
      throw new Error(`This chain has been linked to another filter`);
    }
    if (!this.filter) {
      const src = this.source;
      if (src.length < connectedPipeCount) {
        throw new Error(`No enough pipe to fork as input`);
      }
      const fork = new ChainNode(this.helper, src.slice(0, connectedPipeCount));
      return fork;
    }
    const dest = this.destination;
    if (dest.length < connectedPipeCount) {
      for (let i = dest.length; i <= connectedPipeCount; i++) {
        const pipe = this.helper.createPipe();
        pipe.setBoundInput();
        pipe.hint(`${this.filter}.output.${i}`);
        dest.push(pipe);
      }
    }
    const fork = new ChainNode(this.helper, dest.slice(0, connectedPipeCount));
    return fork;
  }

  connect(...pipes: Pipe[]) {
    if (!this.filter) {
      throw new Error(`Cannot connect empty chain to output`);
    }
    const dest = this.destination;
    if (dest.length > 0) {
      throw new Error(`This chain has already connected to output`);
    }
    for (const pipe of pipes) {
      this.helper.checkPipe(pipe);
      pipe.setBoundInput();
      dest.push(pipe);
    }
    return this;
  }

  link(node: ChainNode): ChainNode {
    if (this.next) {
      throw new Error(`This chain has already connected to output`);
    }
    if (!this.filter) {
      throw new Error(`Cannot connect empty chain to other chain`);
    }
    this.helper.linkNode(this, node);
    return node;
  }

  *[Symbol.iterator](): Iterator<Pipe> {
    if (!this.filter) {
      for (const pipe of this.source) {
        yield pipe;
      }
      return;
    }
    const dest = this.destination;
    for (const pipe of dest) {
      yield pipe;
    }
    while (dest.length < SPREAD_OPERATOR_DETECT_THRESOLD) {
      const pipe = this.helper.createPipe();
      pipe.setBoundInput();
      pipe.hint(`${this.filter}.output.${dest.length}`);
      dest.push(pipe);
      yield pipe;
    }
    throw new Error(`Do not use spread operator on chain.`);
  }

  /** @internal */
  toString() {
    if (this.filter) {
      return `${this.source.join('')}${this.filter}${this.destination.join('')}`;
    }
    return '';
  }
}

export function traverseChainNodes(chain: ChainNode) {
  const nodes: ChainNode[] = [];
  let cursor: ChainNode | null = chain;
  while (cursor && !nodes.includes(cursor)) {
    nodes.push(cursor);
    cursor = cursor.next;
  }
  cursor = chain.prev;
  while (cursor && !nodes.includes(cursor)) {
    nodes.unshift(cursor);
    cursor = cursor.prev;
  }
  return nodes;
}

class FilterComplexHelper {
  anonymousPipeCounter = 0;
  trackingPipes = new Set<Pipe>();
  chains: ChainNode[] = [];
  completed = false;

  createPipe(name?: string) {
    let pipe: Pipe;
    if (name) {
      pipe = new Pipe(name, true);
    } else {
      pipe = new Pipe(`_${++this.anonymousPipeCounter}`);
    }
    this.trackingPipes.add(pipe);
    return pipe;
  }

  checkPipe(pipe: Pipe) {
    if (!pipe.shared && !this.trackingPipes.has(pipe)) {
      throw new Error(`External pipe ${pipe.inspect()} is not shared.`);
    }
  }

  createChain(source: Pipe[]) {
    const chain = new ChainNode(this, source);
    this.addChain(chain);
    return chain;
  }

  addChain(chain: ChainNode) {
    if (this.completed) {
      throw new Error(`Cannot add chain out of context`);
    }
    this.chains.push(chain);
  }

  linkNode(from: ChainNode, to: ChainNode) {
    const toChain = traverseChainNodes(to);
    if (toChain.includes(from)) {
      throw new Error(`Loop chain`);
    }
    from.next = toChain[0];
    toChain[0].prev = from;
    const toChainIndex = this.chains.indexOf(toChain[0]);
    if (toChainIndex > 0) {
      this.chains.splice(toChainIndex, 1);
    }
  }

  *splitPipe(pipe: Pipe) {
    const splitFilterFunc: FilterFunction | undefined = SplitMap[pipe.mediaType];
    if (splitFilterFunc === undefined) {
      if (pipe.mediaType === 'unknown') {
        throw new Error(`Cannot split ${pipe.inspect()}: Please use pipe.mark() to specify the pipe media type.`);
      } else {
        throw new Error(`Cannot split ${pipe.inspect()}: Cannot find appropriate split filter.`);
      }
    }
    const filter = splitFilterFunc();
    const chain = this.createChain([pipe]).pipe(filter);
    let outputCount = 0;
    for (const output of chain) {
      outputCount += 1;
      filter.arguments = `${outputCount}`;
      yield output;
    }
  }

  getContext(): FilterComplexContext {
    return {
      from: (...source) => this.createChain(source),
      pipe: (name) => this.createPipe(name),
      recycle: (...pipes) => this.sinkPipes(pipes),
      split: (pipe) => this.splitPipe(pipe),
      input: InputProxy,
      filter: FilterProxy,
      fileArgument: FileArgumentFactory,
    };
  }

  renamePipes(map: Record<string, Pipe>) {
    const pipes: Pipe[] = [];
    for (const [newName, pipe] of Object.entries(map)) {
      if (pipe.name === newName) {
        pipes.push(pipe);
      } else if (pipe.fixed) {
        const nullFilter: Filter | undefined = NullFilterMap[pipe.mediaType];
        if (nullFilter === undefined) {
          if (pipe.mediaType === 'unknown') {
            throw new Error(
              `Cannot rename ${pipe.inspect()} to [${newName}]: Please use pipe.mark() to specify the pipe media type.`
            );
          } else {
            throw new Error(`Cannot rename ${pipe.inspect()} to [${newName}]: Cannot find appropriate pass filter.`);
          }
        }
        const [redirectedPipe] = this.createChain([pipe]).pipe(nullFilter);
        pipes.push(redirectedPipe.as(newName));
      } else {
        pipes.push(pipe.as(newName));
      }
    }
    return pipes;
  }

  sinkPipes(pipes: (Pipe | null | undefined)[]) {
    pipes.forEach((pipe) => {
      if (pipe && pipe.boundInput && !pipe.boundOutput) {
        const nullSink: Filter | undefined = NullSinkMap[pipe.mediaType];
        if (nullSink === undefined) {
          if (pipe.mediaType === 'unknown') {
            throw new Error(`Cannot sink ${pipe.inspect()}: Please use pipe.mark() to specify the pipe media type.`);
          } else {
            throw new Error(`Cannot sink ${pipe.inspect()}: Cannot find appropriate sink filter.`);
          }
        }
        this.createChain([pipe]).pipe(nullSink);
      }
    });
  }

  checkTrackingPipes() {
    const nameMap = new Map<string, Pipe>();
    this.trackingPipes.forEach((pipe) => {
      const { boundInput, boundOutput, name } = pipe;
      if (boundInput || boundOutput) {
        const sameNamePipe = nameMap.get(name);
        if (sameNamePipe) {
          throw new Error(`Pipe with the same name: ${pipe.inspect()} and ${sameNamePipe.inspect()}`);
        }
        nameMap.set(name, pipe);
      }
    });
    this.trackingPipes.forEach((pipe) => {
      const { boundInput, boundOutput } = pipe;
      if (boundInput !== boundOutput) {
        if (!boundInput) {
          throw new Error(`Pipe ${pipe.inspect()} is not bound to any output`);
        } else if (!boundOutput) {
          throw new Error(`Pipe ${pipe.inspect()} is not bound to any input`);
        }
      }
    });
  }

  toString() {
    return this.chains
      .map((chain) => {
        const nodes = traverseChainNodes(chain);
        const strippedNodes = nodes.filter((n) => n.filter !== null);
        if (strippedNodes.length === 0) {
          return null;
        }
        return strippedNodes.join(',');
      })
      .filter((s) => s !== null)
      .join(';');
  }

  complete(exports?: Record<string, Pipe>) {
    if (exports) {
      this.renamePipes(exports).forEach((p) => p.setBoundOutput());
    }
    this.checkTrackingPipes();
    this.completed = true;
    return this.toString();
  }
}

export function filterComplex(f: (c: FilterComplexContext) => void | Record<string, Pipe>): string;
export function filterComplex(f: (c: FilterComplexContext) => Promise<void | Record<string, Pipe>>): Promise<string>;
export function filterComplex(
  f: (c: FilterComplexContext) => void | Record<string, Pipe> | Promise<void | Record<string, Pipe>>
) {
  const helper = new FilterComplexHelper();
  const c = helper.getContext();
  const result = f(c);
  if (result?.then && !(result.then instanceof Pipe)) {
    return result.then((r) => helper.complete(r as undefined | Record<string, Pipe>));
  }
  return helper.complete(result as undefined | Record<string, Pipe>);
}
