export type FilterArgumentValue = number | string;
export type FilterArgument = FilterArgumentValue | Record<string, FilterArgumentValue | FileArgument> | FilterArgumentValue[];
export type FilterFunction = (...args: FilterArgument[]) => Filter;
export interface IterableStreamLikeArray<T> extends Iterable<T> {
  [index: number]: T;

  /** @deprecated */
  toArray(count: number): T[];

  /**
   * Pick first `count` element(s) and return as an array.
   */
  pick(count: number): T[];
}
export type InputFileStreamMap = IterableStreamLikeArray<Pipe> & Record<string, Pipe>;
export type FilterMap = Record<string, FilterFunction>;

/**
 * Context object for filtergraph generation.
 */
export interface FilterComplexContext {
  /**
   * Access to the context when using destructuring function parameter.
   */
  context: Readonly<FilterComplexContext>;

  /**
   * Build an empty filter chain.
   * 
   * @param labels Pipes that will connect to input pads of chain.
   * @returns The start node of the filter chain.
   */
  from: (...labels: Pipe[]) => ChainNode;

  /**
   * Build a filter chain that sourced from the specified filter.
   * 
   * @param filterOrFunc Filter or its factory.
   * @param labels Pipes that will connect to input pads of chain.
   * @returns The start node of the filter chain.
   */
  use: (filterOrFunc: Filter | FilterFunction, ...labels: Pipe[]) => ChainNode;

  /**
   * Create a pipe.
   * 
   * @param name Name of pipe. Must be unique.
   * @returns The created pipe.
   */
  pipe: (name?: string) => Pipe;

  /**
   * Connect pipes to corresponding [nullsink](https://ffmpeg.org/ffmpeg-filters.html#nullsink) filter if their outputs are not connected.
   * 
   * @param labels Pipes to be connected. Can be `null` or `undefined`.
   */
  recycle: (...labels: (Pipe | null | undefined)[]) => void;

  /**
   * Connect the specified pipe to corresponding [split](https://ffmpeg.org/ffmpeg-filters.html#split_002c-asplit) filter.
   * This allows data to flows into multiple filters.
   * 
   * @param pipe Pipe.
   * @returns Split pipes.
   */
  split: (pipe: Pipe) => Iterable<Pipe>;

  /**
   * Concatenate video and audio streams, joining them together one after another.
   * 
   * See [concat filter](https://ffmpeg.org/ffmpeg-filters.html#concat) for more details.
   * 
   * @param videoStreams Segments in the video streams.
   * @param audioStreams Segments in the audio streams.
   * @returns A builder for further operations.
   */
  concat: (videoStreams?: Pipe[][], audioStreams?: Pipe[][]) => ConcatFilterBuilder;

  /**
   * Create a context for building [commands](https://ffmpeg.org/ffmpeg-filters.html#Commands-syntax).
   * 
   * If `f` is specified, `f` will be invoked within the context, and then the context will be returned.
   */
  command: (f?: (context: Readonly<CommandBuilderContext>) => void) => Readonly<CommandBuilderContext>;

  /**
   * Input streams.
   */
  input: Readonly<IterableStreamLikeArray<Readonly<InputFileStreamMap>>>;

  /**
   * Filters.
   */
  filter: Readonly<FilterMap>;

  /**
   * Read argument from a file and pass to the filter.
   * 
   * @param path File path.
   * @returns The file argument that can be passed to `FilterFunction`.
   */
  fileArgument: (path: string) => FileArgument;
}

export const FilterComplexContext = {} as FilterComplexContext;

export type PipeMediaType = 'unknown' | 'video' | 'audio' | 'data' | 'subtitle' | 'attachment' | 'nb';

/**
 * Represents the pipe (link) between filter pads.
 */
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
  shared: boolean;

  /**
   * Internal use only. Please use `FilterComplexContext.pipe()`.
   */
  constructor(name: string, fixed?: boolean, shared?: boolean) {
    this.name = name;
    this.fixed = fixed ?? false;
    this.shared = shared ?? false;
  }

  /**
   * Give this pipe an unique name in order to refer to it elsewhere.
   * 
   * It makes this pipe fixed and prevents renaming.
   * 
   * An error will be thrown if this pipe is fixed.
   * 
   * @param name Name of the pipe.
   */
  as(name: string) {
    if (this.fixed) {
      throw new Error(`Cannot rename a fixed pipe: ${this.inspect()}`);
    }
    this.name = name;
    this.fixed = true;
    return this;
  }

  /**
   * Mark this pipe with the specified media type.
   * 
   * @param mediaType Media type.
   */
  mark(mediaType: PipeMediaType) {
    if (this.mediaType === mediaType) {
      return this;
    }
    if (this.mediaType !== 'unknown') {
      throw new Error(`Cannot mark this pipe as ${mediaType}, since it has been marked as ${this.mediaType}`);
    }
    this.mediaType = mediaType;
    return this;
  }

  /**
   * Set the hint of the pipe.
   * 
   * It will be used in error messages.
   * 
   * @param hint Hint
   */
  hint(hint: string) {
    this.hintText = hint;
    return this;
  }

  /**
   * Notify that the input side of the pipe is connected to another pad.
   * 
   * This will throw an error if the input side has already been connected.
   */
  setBoundInput() {
    if (this.boundInput) {
      throw new Error(`Pipe ${this.inspect()} has been bound to other output pad`);
    }
    this.boundInput = true;
    return this;
  }

  /**
   * Notify that the output side of the pipe is connected to another pad.
   * 
   * This will throw an error if the output side has already been connected.
   */
  setBoundOutput() {
    if (this.boundOutput) {
      throw new Error(`Pipe ${this.inspect()} has been bound to other input pad, please use split or asplit filter`);
    }
    if (!this.shared) {
      this.boundOutput = true;
    }
    return this;
  }

  /**
   * Return the string representation of this pipe (e.g. `[pipe]`).
   */
  toString() {
    return `[${this.name}]`;
  }

  /**
   * Similar to `toString()`, but only for debugging purpose.
   */
  inspect() {
    if (this.hintText) {
      return `[${this.name}](${this.hintText})`;
    }
    return `[${this.name}]`;
  }
}

export type PipeReference = [Pipe];

const SPREAD_OPERATOR_DETECT_THRESOLD = 128;
const IterableStreamLikeArrayProto: IterableStreamLikeArray<unknown> = {
  pick(count) {
    const arr = new Array(count);
    for (let i = 0; i < count; i++) {
      arr[i] = this[i];
    }
    return arr;
  },
  toArray(count) {
    return this.pick(count);
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
        const pipe = new Pipe(`${inputIndex}:${streamSpecifier}`, true, true);
        pipe.setBoundInput();
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
  readonly path: string;

  /**
   * Recommend using `FilterComplexContext.fileArgument()`.
   */
  constructor(path: string) {
    this.path = path;
  }
}

const FileArgumentFactory = (path: string) => new FileArgument(path);

export function escapeFilterArgumentValue(value: FilterArgumentValue): string {
  return String(value).replace(/[\\:']/g, '\\$&');
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
    const quoteParts = arg.split(/([\\',])/);
    return quoteParts
      .map((e, i) => i % 2 === 0 ? (e !== '' ? `'${e}'` : '') : `\\${e}`)
      .join('');
  }
  return arg.replace(/[\\'[\],;]/g, '\\$&');
}

/**
 * Represents a filter in the filtergraph.
 */
export class Filter {
  /** @internal */
  readonly name: string;
  /** @internal */
  id?: string;
  /** @internal */
  arguments?: string;

  /**
   * Recommend using `FilterComplexContext.filter`.
   */
  constructor(name: string, args: FilterArgument[]) {
    this.name = name;
    if (args.length > 0) {
      this.arguments = parseFilterArguments(args);
    }
  }

  /**
   * Set the instance name to distinguish it from other filters.
   * 
   * @param id Instance name.
   */
  ref(id: string) {
    this.id = id;
    return this;
  }

  /**
   * Update the arguments for this filter.
   */
  setArguments(...args: FilterArgument[]) {
    if (args.length > 0) {
      this.arguments = parseFilterArguments(args);
    } else {
      this.arguments = undefined;
    }
  }

  /**
   * Return the string representation of this filter (e.g. `name@id`).
   */
  toString(withArguments?: boolean) {
    const name = `${this.name}${this.id ? `@${this.id}` : ''}`;
    if (withArguments && this.arguments !== undefined) {
      return `${name}=${escapeFilterArgument(this.arguments, true)}`;
    }
    return name;
  }
}

const FilterNameSymbol = Symbol('filterName');
type FilterFunctionInternal = FilterFunction & { [FilterNameSymbol]: string }
const FilterProxy = createCachedGetterProxy<Record<string, FilterFunction>>({}, (filterName) => {
  const filterFunc = (...args: FilterArgument[]) => {
    return new Filter(filterName as string, args);
  };
  filterFunc[FilterNameSymbol] = filterName;
  return filterFunc as FilterFunctionInternal;
});
const NullFilterMap: Partial<Record<PipeMediaType, Filter>> = {
  video: FilterProxy.null(),
  audio: FilterProxy.anull(),
};
const NullSinkMap: Partial<Record<PipeMediaType, Filter>> = {
  video: FilterProxy.nullsink(),
  audio: FilterProxy.anullsink(),
};
const SplitFilterMap: Partial<Record<PipeMediaType, FilterFunction>> = {
  video: FilterProxy.split,
  audio: FilterProxy.asplit,
};
const ConcatFilter = FilterProxy.concat;
const SendCommandFilterMap: Partial<Record<PipeMediaType, FilterFunction>> = {
  video: FilterProxy.sendcmd,
  audio: FilterProxy.asendcmd,
};

/**
 * Represents a node in the filter chain.
 * 
 * Iterate over this object to retrieve pipes connected to the output pads.
 */
export class ChainNode implements Iterable<Pipe> {
  /** @internal */
  helper: FilterComplexHelper;
  /** @internal */
  source: PipeReference[];
  /** @internal */
  filter?: Filter;
  /** @internal */
  swsFlags?: string;
  /** @internal */
  destination: Pipe[];
  /** @internal */
  prev?: ChainNode;
  /** @internal */
  next?: ChainNode;

  private constructor();
  /** @internal */
  private constructor(helper: FilterComplexHelper, source: PipeReference[])
  private constructor(helper?: FilterComplexHelper, source?: PipeReference[]) {
    if (!helper || !source) {
      throw new Error('Internal use only');
    }
    this.helper = helper;
    this.source = source;
    this.filter = undefined;
    this.swsFlags = undefined;
    this.destination = [];
    this.prev = undefined;
    this.next = undefined;
  }

  /** @internal */
  static create(helper: FilterComplexHelper, source: PipeReference[]) {
    return new this(helper, source);
  }

  /**
   * Append a filter node to the filter chain.
   * 
   * If this node is a start node, it will be replaced by
   * the appended node.
   * 
   * @param filterOrFunc Filter or its filter factory.
   * @param swsFlags Flags that will be passed to swscale filters.
   * @returns The appended node.
   */
  pipe(filterOrFunc: Filter | FilterFunction, swsFlags?: string) {
    if (this.next) {
      throw new Error(`This chain has been linked to another filter`);
    }
    const filter = typeof filterOrFunc === 'function' ? filterOrFunc() : filterOrFunc;
    if (!this.filter) {
      this.filter = filter;
      this.swsFlags = swsFlags;
      this.source.forEach((p) => this.helper.setBoundOutputForPipeReference(p));
      return this;
    }
    const next = new ChainNode(this.helper, []);
    next.pipe(filter, swsFlags);
    this.next = next;
    next.prev = this;
    return next;
  }

  /**
   * Build a new filter chain and connect its input to the output pads of this filter chain.
   * 
   * @param connectedPipeCount Number of pipes to be passed to the new filter chain.
   * @returns The start node of the new filter chain.
   */
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
    const forkSources: Pipe[] = [];
    for (let i = 0; i < connectedPipeCount; i++) {
      forkSources[i] = this.getOutputPipe(i);
    }
    const fork = this.helper.createChain(forkSources);
    return fork;
  }

  /**
   * Connect pipes to the output pads.
   * 
   * @param pipes Pipes to be connected.
   */
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

  /**
   * Join this filter chain with another filter chain.
   * 
   * @param node Last node of the other filter chain
   * @returns Last node of the joined filter chain
   */
  link(node: ChainNode): ChainNode {
    if (this.next) {
      throw new Error(`This chain has already connected to output`);
    }
    if (!this.filter) {
      throw new Error(`Cannot connect empty chain to other chain`);
    }
    return this.helper.linkNode(this, node);
  }

  /**
   * Return an iterator that can retrieve pipes connected to the output pads.
   */
  *[Symbol.iterator](): Iterator<Pipe> {
    if (!this.filter) {
      for (const [pipe] of this.source) {
        yield pipe;
      }
      return;
    }
    for (let i = 0; i < SPREAD_OPERATOR_DETECT_THRESOLD; i++) {
      yield this.getOutputPipe(i);
    }
    throw new Error(`Do not use spread operator on chain.`);
  }

  /** @internal */
  getOutputPipe(index: number) {
    if (index < this.destination.length) {
      return this.destination[index];
    }
    const pipe = this.helper.createPipe();
    pipe.setBoundInput();
    pipe.hint(`${this.filter}.output.${index}`);
    this.destination[index] = pipe;
    return pipe;
  }

  /** @internal */
  toString() {
    if (this.filter) {
      const swsFlags = this.swsFlags ? `sws_flags=${this.swsFlags};` : '';
      const sources = this.source.join('');
      const filter = this.filter.toString(true);
      const destinations = this.destination.join('');
      return `${swsFlags}${sources}${filter}${destinations}`;
    }
    return '';
  }
}

/**
 * Helper for building a `concat` filter chain.
 */
export class ConcatFilterBuilder implements Iterable<Pipe> {
  /** @internal */
  helper: FilterComplexHelper;
  /** @internal */
  videoStreams: Pipe[][];
  /** @internal */
  audioStreams: Pipe[][];
  /** @internal */
  outputPipes?: Pipe[];
  
  private constructor();
  /** @internal */
  private constructor(helper: FilterComplexHelper);
  private constructor(helper?: FilterComplexHelper) {
    if (!helper) {
      throw new Error('Internal use only');
    }
    this.helper = helper;
    this.videoStreams = [];
    this.audioStreams = [];
  }

  /** @internal */
  static create(helper: FilterComplexHelper) {
    return new this(helper);
  }

  /**
   * Join synchronized video segments into a video stream.
   *
   * This method should not be used with `segment()`.
   * 
   * @param pipes The synchronized video segments.
   */
  video(...pipes: Pipe[]) {
    if (this.outputPipes) {
      throw new Error(`Cannot modify a completed builder.`);
    }
    this.helper.checkPipes(pipes);
    const firstVideoPipeStream = this.videoStreams[0];
    if (firstVideoPipeStream && firstVideoPipeStream.length !== pipes.length) {
      throw new Error(`Should provide exactly ${firstVideoPipeStream.length} segments.`);
    }
    this.videoStreams.push([...pipes]);
    return this;
  }

  /**
   * Join synchronized audio segments into an audio stream.
   *
   * This method should not be used with `segment()`.
   * 
   * @param pipes The synchronized audio segments.
   */
  audio(...pipes: Pipe[]) {
    if (this.outputPipes) {
      throw new Error(`Cannot modify a completed builder.`);
    }
    this.helper.checkPipes(pipes);
    const firstAudioPipeStream = this.audioStreams[0];
    if (firstAudioPipeStream && firstAudioPipeStream.length !== pipes.length) {
      throw new Error(`Should provide exactly ${firstAudioPipeStream.length} segments.`);
    }
    this.audioStreams.push([...pipes]);
    return this;
  }

  /**
   * Add a segment with synchronized video and audio streams.
   *
   * This method should not be used with `video()` and `audio()`.
   * 
   * @param videoPipes The synchronized video streams.
   * @param audioPipes The synchronized audio streams.
   */
  segment(videoPipes: Pipe[], audioPipes: Pipe[]) {
    if (this.outputPipes) {
      throw new Error(`Cannot modify a completed builder.`);
    }
    this.helper.checkPipes(videoPipes);
    this.helper.checkPipes(audioPipes);
    const videoStreamCount = this.videoStreams.length;
    const audioStreamCount = this.audioStreams.length;
    if (videoStreamCount > 0 || audioStreamCount > 0) {
      if (videoStreamCount !== videoPipes.length || audioStreamCount !== audioPipes.length) {
        throw new Error(`Should provide exactly ${videoStreamCount} video stream(s) and ${audioStreamCount} audio stream(s).`);
      }
      for (let i = 0; i < videoStreamCount; i++) {
        this.videoStreams[i].push(videoPipes[i]);
      }
      for (let i = 0; i < audioStreamCount; i++) {
        this.audioStreams[i].push(audioPipes[i]);
      }
    } else {
      for (const videoPipe of videoPipes) {
        this.videoStreams.push([videoPipe]);
      }
      for (const audioPipe of audioPipes) {
        this.audioStreams.push([audioPipe]);
      }
    }
    return this;
  }

  /**
   * Build a `concat` chain and return the concatenated output pipes.
   * 
   * @returns An array of `Pipe`, representing `[...videoStreams, ...audioStreams]`.
   */
  build() {
    if (this.outputPipes) {
      return this.outputPipes;
    }
    const streams = [...this.videoStreams, ...this.audioStreams];
    if (streams.length === 0) {
      throw new Error(`Should provide at least 1 video/audio segment.`);
    }
    const outputPipes: Pipe[] = [];
    const videoStreamCount = this.videoStreams.length;
    const audioStreamCount = this.audioStreams.length;
    let segmentCount = Infinity;
    for (const segments of streams) {
      segmentCount = Math.min(segments.length, segmentCount);
      outputPipes.push(this.helper.createPipe());
    }
    const chainSource: Pipe[] = [];
    for (let i = 0; i < segmentCount; i++) {
      chainSource.push(...streams.map((stream) => stream[i]));
    }
    outputPipes.forEach((pipe, i) => {
      if (i >= videoStreamCount) {
        pipe.mark('audio');
      } else {
        pipe.mark('video');
      }
    })
    this.helper.createChain(chainSource)
      .pipe(ConcatFilter({
        n: segmentCount,
        v: videoStreamCount,
        a: audioStreamCount
      }))
      .connect(...outputPipes);
    this.outputPipes = outputPipes;
    return outputPipes;
  }

  [Symbol.iterator]() {
    return this.build()[Symbol.iterator]();
  }
}

/**
 * Context object for command generation.
 */
export interface CommandBuilderContext {
  /**
   * Access to the context when using destructuring function parameter.
   */
  context: Readonly<CommandBuilderContext>;

  /**
   * Create a interval and return its builder.
   * 
   * @param start The start time of the interval.
   * @param end The end time of the interval.
   * @returns The interval builder.
   */
  when: (start: string | number, end?: string | number) => CommandIntervalBuilder;

  /**
   * Create the corresponding [sendcmd](https://ffmpeg.org/ffmpeg-filters.html#sendcmd_002c-asendcmd) filter.
   * 
   * @param mediaType Media type of the sibling pads.
   */
  toFilter(mediaType: PipeMediaType): Filter;

  /**
   * Return the string representation of this commands description.
   */
  toString(): string;
}

class CommandBuilderHelper {
  intervals: CommandIntervalBuilder[] = [];

  createInterval(start: string | number, end?: string | number) {
    const interval = new CommandIntervalBuilder(start, end);
    this.intervals.push(interval);
    return interval;
  }

  getContext() {
    const ctx = {
      when: (start, end) => this.createInterval(start, end),
      toFilter: (mediaType) => this.toFilter(mediaType),
      toString: () => this.toString()
    } as Partial<CommandBuilderContext>;
    return ctx.context = ctx as Readonly<CommandBuilderContext>;
  }

  toFilter(mediaType: PipeMediaType) {
    const sendCommandFilterFunc: FilterFunction | undefined = SendCommandFilterMap[mediaType];
    if (sendCommandFilterFunc === undefined) {
      throw new Error(`Cannot create filter for media type ${mediaType}.`);
    }
    const filter = sendCommandFilterFunc(this.toString());
    return filter;
  }

  toString() {
    const intervals = this.intervals.map((interval) => interval.toString());
    return intervals.join(';');
  }
}

/**
 * Builder for command intervals.
 */
export class CommandIntervalBuilder {
  /** @internal */
  start: string | number;
  /** @internal */
  end?: string | number;
  /** @internal */
  commands: Array<{
    flags: string;
    target: string;
    command: string;
    arg: string;
  }>;

  /**
   * Recommend using `CommandBuilderContext.when()`.
   */
  constructor(start: string | number, end?: string | number) {
    this.start = start;
    this.end = end;
    this.commands = [];
  }

  /**
   * Add a command into the interval.
   * 
   * See [commands syntax](https://ffmpeg.org/ffmpeg-filters.html#Commands-syntax) for details about arguments.
   */
  on(flags: string | string[], target: string | FilterFunction | Filter, command: string, ...args: FilterArgument[]) {
    const flagStr = Array.isArray(flags) ? flags.join('+') : flags;
    const targetStr = typeof target === 'string'
      ? target
      : target instanceof Filter
        ? target.toString()
        : (target as FilterFunctionInternal)[FilterNameSymbol];
    const argStr = parseFilterArguments(args);
    this.commands.push({ flags: flagStr, target: targetStr, command, arg: argStr });
    return this;
  }

  /**
   * Shorthand for `on('enter', ...)`.
   * 
   * See [commands syntax](https://ffmpeg.org/ffmpeg-filters.html#Commands-syntax) for details about arguments.
   */
  onEnter(target: string | FilterFunction | Filter, command: string, ...args: FilterArgument[]) {
    return this.on('enter', target, command, ...args);
  }

  /**
   * Shorthand for `on('leave', ...)`.
   * 
   * See [commands syntax](https://ffmpeg.org/ffmpeg-filters.html#Commands-syntax) for details about arguments.
   */
  onLeave(target: string | FilterFunction | Filter, command: string, ...args: FilterArgument[]) {
    return this.on('leave', target, command, ...args);
  }

  /**
   * Shorthand for `on('enter+leave', ...)`.
   * 
   * See [commands syntax](https://ffmpeg.org/ffmpeg-filters.html#Commands-syntax) for details about arguments.
   */
  onEnterOrLeave(target: string | FilterFunction | Filter, command: string, ...args: FilterArgument[]) {
    return this.on(['enter', 'leave'], target, command, ...args);
  }

  /** @internal */
  toString() {
    const range = this.end !== undefined ? `${this.start}-${this.end}` : `${this.start}`;
    const commands = this.commands.map(({ flags, target, command, arg }) => `[${flags}] ${target} ${command} ${arg}`);
    if (commands.length > 0) {
      return `${range} ${commands.join(',')}`;
    }
    return '';
  }
}

export function traverseChainNodes(chain: ChainNode) {
  const nodes: ChainNode[] = [];
  let cursor: ChainNode | undefined = chain;
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

interface TrackingPipeReferenceGroup {
  references: Set<PipeReference>;
  splitter?: () => Pipe;
}

class FilterComplexHelper {
  anonymousPipeCounter = 0;
  trackingPipes = new Set<Pipe>();
  trackingPipeReferences = new Map<Pipe, TrackingPipeReferenceGroup>();
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

  checkPipes(pipes: Pipe[]) {
    for (const pipe of pipes) {
      this.checkPipe(pipe);
    }
  }

  asPipeReference(pipe: Pipe) {
    const newReference = [pipe] as PipeReference;
    if (!pipe.shared) {
      let referenceGroup = this.trackingPipeReferences.get(pipe);
      if (!referenceGroup) {
        referenceGroup = { references: new Set() };
        this.trackingPipeReferences.set(pipe, referenceGroup);
      }
      referenceGroup.references.add(newReference);
    }
    return newReference;
  }

  asPipeReferences(pipes: Pipe[]) {
    return pipes.map((pipe) => this.asPipeReference(pipe));
  }

  createChain(source: Pipe[]) {
    const chain = ChainNode.create(this, this.asPipeReferences(source));
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
    return toChain[toChain.length - 1];
  }

  concatPipe(videoStreams?: Pipe[][], audioStreams?: Pipe[][]) {
    const builder = ConcatFilterBuilder.create(this);
    if (videoStreams) {
      for (const videoStream of videoStreams) {
        builder.video(...videoStream);
      }
    }
    if (audioStreams) {
      for (const audioStream of audioStreams) {
        builder.audio(...audioStream);
      }
    }
    return builder;
  }

  createSplitFilter(pipe: Pipe) {
    const splitFilterFunc: FilterFunction | undefined = SplitFilterMap[pipe.mediaType];
    if (splitFilterFunc === undefined) {
      if (pipe.mediaType === 'unknown') {
        throw new Error(`Cannot split ${pipe.inspect()}: Please use pipe.mark() to specify the pipe media type.`);
      } else {
        throw new Error(`Cannot split ${pipe.inspect()}: Cannot find appropriate split filter.`);
      }
    }
    return splitFilterFunc();
  }

  *splitPipe(pipe: Pipe) {
    const filter = this.createSplitFilter(pipe);
    const chain = this.createChain([pipe]).pipe(filter);
    let outputCount = 0;
    for (const output of chain) {
      outputCount += 1;
      filter.arguments = `${outputCount}`;
      yield output;
    }
  }

  createUnderlyingPipeSplitter(pipeReference: PipeReference) {
    const [pipe] = pipeReference;
    const filter = this.createSplitFilter(pipe);
    const chain = this.createChain([]);
    chain.source.push([pipe]);
    chain.filter = filter;
    const generator = chain[Symbol.iterator]();
    const splitter = () => generator.next().value! as Pipe;
    const replacementPipe = splitter();
    pipeReference[0] = replacementPipe;
    replacementPipe.setBoundOutput();
    return splitter;
  }

  setBoundOutputForPipeReference(pipeReference: PipeReference, keepName?: boolean) {
    const [pipe] = pipeReference;
    if (pipe.shared) return;
    const referenceGroup = this.trackingPipeReferences.get(pipe);
    if (!referenceGroup) {
      throw new Error(`Pipe reference is not tracking: ${pipe.inspect()}`);
    }
    const { references } = referenceGroup;
    if (!references.has(pipeReference)) {
      throw new Error(`Pipe reference is not tracking: ${pipe.inspect()}`);
    }
    if (pipe.boundOutput) {
      let { splitter } = referenceGroup;
      if (!splitter) {
        const [inputPipeReference] = references;
        splitter = this.createUnderlyingPipeSplitter(inputPipeReference);
      }
      const newSplitedPipe = splitter();
      pipeReference[0] = newSplitedPipe;
      if (keepName) {
        [pipe.name, newSplitedPipe.name] = [newSplitedPipe.name, pipe.name];
      }
    }
    pipeReference[0].setBoundOutput();
  }

  buildCommands(f?: (context: Readonly<CommandBuilderContext>) => void) {
    const helper = new CommandBuilderHelper();
    const context = helper.getContext();
    if (f) {
      f(context);
    }
    return context;
  }

  getContext() {
    const ctx = {
      from: (...source) => this.createChain(source),
      use: (filterOrFunc, ...source) => this.createChain(source).pipe(filterOrFunc),
      pipe: (name) => this.createPipe(name),
      recycle: (...pipes) => this.sinkPipes(pipes),
      split: (pipe) => this.splitPipe(pipe),
      concat: (videoStreams, audioStreams) => this.concatPipe(videoStreams, audioStreams),
      command: (f) => this.buildCommands(f),
      input: InputProxy,
      filter: FilterProxy,
      fileArgument: FileArgumentFactory,
    } as Partial<FilterComplexContext>;
    Object.entries(FilterComplexContext).forEach(([k, v]) => {
      let value = v;
      if (typeof value === 'function') {
        value = value.bind(ctx);
      }
      (ctx as any)[k] = value;
    });
    return ctx.context = ctx as Readonly<FilterComplexContext>;
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
        const strippedNodes = nodes.filter((n) => n.filter !== undefined);
        if (strippedNodes.length === 0) {
          return undefined;
        }
        return strippedNodes.join(',');
      })
      .filter((s) => s !== undefined)
      .join(';');
  }

  complete(exports?: Record<string, Pipe>) {
    if (this.completed) {
      throw new Error(`Completed filtergraph`);
    }
    if (exports) {
      this.renamePipes(exports).forEach((pipe) => {
        const pipeReference = this.asPipeReference(pipe);
        this.setBoundOutputForPipeReference(pipeReference, true);
      });
    }
    this.checkTrackingPipes();
    this.completed = true;
    return this.toString();
  }
}

/**
 * Invoke the specified function `f` within a special context and return the generated [filtergraph](https://ffmpeg.org/ffmpeg-filters.html#Filtergraph-syntax-1).
 * 
 * Pipes returned by `f` will be named and exported.
 * 
 * If `f` is not provided, the special context returns instead. 
 */
export function filterComplex(f: (c: Readonly<FilterComplexContext>) => void | Record<string, Pipe>): string;
export function filterComplex(f: (c: Readonly<FilterComplexContext>) => Promise<void | Record<string, Pipe>>): Promise<string>;
export function filterComplex(): Readonly<FilterComplexContext> & { complete: (exports?: Record<string, Pipe>) => string };
export function filterComplex(
  f?: (c: Readonly<FilterComplexContext>) => void | Record<string, Pipe> | Promise<void | Record<string, Pipe>>
) {
  const helper = new FilterComplexHelper();
  const context = helper.getContext();
  const complete = (exports?: Record<string, Pipe>) => helper.complete(exports);
  if (f) {
    const result = f(context);
    if (typeof result?.then === 'function') {
      return result.then(complete as (exports: void | Record<string, Pipe>) => string);
    }
    return complete(result as undefined | Record<string, Pipe>);
  }
  return Object.assign(context, { complete });
}
