import { strict as assert } from 'assert';
import { filterComplex } from 'ffmpeg-filter-compose';
import 'ffmpeg-filter-compose-extension';

(async function() {
    assert.equal(
        filterComplex(({ input, scale, crop }) => {
            const videoOutput = scale(crop(input[0].v, [400, 200, 12, 34]), { w: 200, h: 100 });
            return { videoOutput };
        }),
        `[0:v]crop=400:200:12:34[_1];[_1]scale=w=200:h=100[videoOutput]`
    );

    assert.equal(
        filterComplex(({ movie, scale, histogram, showfreqs, hstack }) => {
            const [video, audio] = movie({ filename: 'test.mp4', s: 'dv+da' });
            const out = hstack(
                3,
                scale(video, '640x360'),
                scale(histogram(video), '640x360'),
                showfreqs(audio, { s: '640x360' })
            );
            return [out, audio];
        }),
        `movie=filename=test.mp4:s=dv+da[_1][_2];[_4]scale=640x360[_3];[_5]histogram[_6];[_1]split[_4][_5];[_6]scale=640x360[_7];[_10]showfreqs=s=640x360[_8];[_3][_7][_8]hstack=3[out0];[_2]asplit[_10][out1]`
    );

    console.log('Test passed!');
})();