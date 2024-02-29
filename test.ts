import { strict as assert } from 'assert';
import { filterComplex } from './index';

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
    
    const videoCount = 3;
    assert.equal(
        filterComplex(({ from, input, filter }) => {
            const videos = input.toArray(videoCount).map((e) => e.v);
            const concatParts = videos.map((v) => {
                const [fade] = from(v).pipe(filter.fade({ t: 'in', d: 1 }));
                return fade;
            });
            const [out] = from(...concatParts).pipe(filter.concat({ n: videoCount, v: 1 }));
            return { out };
        }),
        `[0:v]fade='t=in:d=1'[_1];[1:v]fade='t=in:d=1'[_2];[2:v]fade='t=in:d=1'[_3];[_1][_2][_3]concat='n=3:v=1'[out]`
    );

    assert.equal(
        filterComplex(({ from, pipe, filter }) => {
            const L1 = pipe('L1');
            const L2 = pipe('L2');
            from().pipe(filter.testsrc)
                .link(from().pipe(filter.split).connect(L1))
                .link(from().pipe(filter.hflip).connect(L2));
            const [out] = from(L1, L2).pipe(filter.hstack);
            return { out };
        }),
        `testsrc,split[L1],hflip[L2];[L1][L2]hstack[out]`
    );
})()