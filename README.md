# FFmpeg-Filter-Compose

[Filtergraph](https://ffmpeg.org/ffmpeg-filters.html#Filtergraph-description) generator with composing API for [FFmpeg](https://ffmpeg.org/).

## Usage

Basic chain:
```js
filterComplex(({ from, input, filter }) => {
    const [videoOutput] = from(input[0].v)
        .pipe(filter.crop([400, 200, 12, 34]))
        .pipe(filter.scale({ w: 200, h: 100 }));
    return { videoOutput };
})
// => `[0:v]crop='400:200:12:34',scale='w=200:h=100'[videoOutput]`
```

Multiple inputs and outputs:
```js
filterComplex(({ from, input, filter, split }) => {
    const [{ v: video }] = input;
    const [main, tmp] = split(video);
    const [flip] = from(tmp)
        .pipe(filter.crop(['iw', 'ih/2', 0, 0]))
        .pipe(filter.vflip);
    const [out] = from(main, flip).pipe(filter.overlay([0, 'H/2']));
    return { out };
})
// => `[0:v]split='2'[_1][_2];[_2]crop='iw:ih/2:0:0',vflip[_3];[_1][_3]overlay='0:H/2'[out]`
```

Apply filter conditionally:
```js
await filterComplex(async ({ from, input, filter }) => {
    let video = input[0].v;
    if (await fetchNegate()) {
        [video] = from(video).pipe(filter.negate);
    }
    return { video };
})
// => `[0:v]negate[video]` or `[0:v]null[video]`
```

Apply fade-in effect, then concatenate videos:
```js
filterComplex(({ from, input, filter }) => {
    const videos = input.toArray(videoCount).map((e) => e.v);
    const concatParts = videos.map((v) => {
        const [fade] = from(v).pipe(filter.fade({ t: 'in', d: 1 }));
        return fade;
    });
    const [out] = from(...concatParts).pipe(filter.concat({ n: videoCount, v: 1 }));
    return { out };
})
// => `[0:v]fade='t=in:d=1'[_1];[1:v]fade='t=in:d=1'[_2];[2:v]fade='t=in:d=1'[_3];[_1][_2][_3]concat='n=3:v=1'[out]`
```

Complex example:
```js
filterComplex(({ from, pipe, filter }) => {
    const L1 = pipe('L1');
    const L2 = pipe('L2');
    from().pipe(filter.testsrc)
        .link(from().pipe(filter.split).connect(L1))
        .link(from().pipe(filter.hflip).connect(L2));
    const [out] = from(L1, L2).pipe(filter.hstack);
    return { out };
})
// => `testsrc,split[L1],hflip[L2];[L1][L2]hstack[out]`
```

## FAQ

Q: Why can't I use the spread operator (`...`)?

A: The spread operator (`...`) cannot be used in this context because we don't have knowledge of the exact input count or filter pad count. Since they are infinite iterable, using the spread operator could potentially produce an infinite number of objects. To address this, you can use the `toArray()` or `fork()` methods to explicitly specify the count of objects.

Q: What is the purpose of `pipe.mark()`? When should I use it?

A: The `pipe.mark()` function is used to specify the media type of a pipe, which helps determine the relevant filter to be applied. For example, when using the `split()` function, specifying the media type with `pipe.mark()` ensures that the appropriate filter, such as `split` for video or `asplit` for audio, is applied.

Q: How can I resolve the error message `Pipe [pipe] is not bound to any input`?

A: This error message indicates that the `[pipe]` object is neither passed to `from().pipe` nor returned from the callback function. To resolve this issue, you should explicitly call the `recycle()` method with the `[pipe]` object to ensure it is properly handled.
