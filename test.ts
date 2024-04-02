import { strict as assert } from 'assert';
import { FilterComplexContext, filterComplex } from './index';

declare module './index' {
    interface FilterComplexContext {
        hflip: () => Filter;
    }
}

(async function() {
    assert.equal(
        filterComplex(({ from, input, filter }) => {
            const [videoOutput] = from(input[0].v)
                .pipe(filter.crop([400, 200, 12, 34]))
                .pipe(filter.scale({ w: 200, h: 100 }));
            return { videoOutput };
        }),
        `[0:v]crop='400:200:12:34',scale='w=200:h=100'[videoOutput]`
    );
    
    assert.equal(
        filterComplex(({ from, input, filter, split }) => {
            const [{ v: video }] = input;
            const [main, tmp] = split(video);
            const [flip] = from(tmp)
                .pipe(filter.crop(['iw', 'ih/2', 0, 0]))
                .pipe(filter.vflip);
            const [out] = from(main, flip).pipe(filter.overlay([0, 'H/2']));
            return { out };
        }),
        `[0:v]split='2'[_1][_2];[_2]crop='iw:ih/2:0:0',vflip[_3];[_1][_3]overlay='0:H/2'[out]`
    );

    let fetchNegate = async () => false;
    const asyncTest = () => filterComplex(async ({ from, input, filter }) => {
        let video = input[0].v;
        if (await fetchNegate()) {
            [video] = from(video).pipe(filter.negate);
        }
        return { video };
    });
    assert.equal(
        await asyncTest(),
        `[0:v]null[video]`
    );
    fetchNegate = async () => true;
    assert.equal(
        await asyncTest(),
        `[0:v]negate[video]`
    );
    
    const videoCount = 2;
    assert.equal(
        filterComplex(({ from, input, filter, concat }) => {
            const inputArr = input.toArray(videoCount);
            const [outv, outa] = concat()
                .video(...inputArr.map((e) => e.v).map((v) => {
                    const [fade] = from(v).pipe(filter.fade({ t: 'in', d: 1 }));
                    return fade;
                }))
                .audio(...inputArr.map((e) => e.a))
                .build();
            return { outv, outa };
        }),
        `[0:v]fade='t=in:d=1'[_1];[1:v]fade='t=in:d=1'[_2];[_1][0:a][_2][1:a]concat='n=2:v=1:a=1'[outv][outa]`
    );

    assert.equal(
        filterComplex(({ from, use, pipe, filter }) => {
            const L1 = pipe('L1');
            const L2 = pipe('L2');
            use(filter.testsrc)
                .link(use(filter.split).connect(L1))
                .link(use(filter.hflip).connect(L2));
            const [out] = from(L1, L2).pipe(filter.hstack);
            return { out };
        }),
        `testsrc,split[L1],hflip[L2];[L1][L2]hstack[out]`
    );

    FilterComplexContext.hflip = function() {
        return this.filter.hflip();
    }
    assert.equal(
        filterComplex(({ from, input, hflip }) => {
            const [out] = from(input[0].v).pipe(hflip());
            return { out };
        }),
        `[0:v]hflip[out]`
    );

    console.log('Test passed!');
})();
