import * as fs from 'fs';
import * as path from 'path';

import { STATION_HOWTO, STATION_VIDEOS, videoUrl } from '../hyroxHowto';
import { STATION_KEYS } from '../hyrox';

const SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'static', 'hyrox.js'), 'utf8');
const start = SOURCE.indexOf('const STATION_VIDEOS = {');
const end = SOURCE.indexOf('// A split\'s stored `key`', start);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const site: any = new Function(`${SOURCE.slice(start, end)}; return { STATION_VIDEOS, STATION_HOWTO };`)();

describe('against the website', () => {
  it('the videos are the same', () => {
    expect(STATION_VIDEOS).toEqual(site.STATION_VIDEOS);
  });

  it('the words are the same', () => {
    expect(STATION_HOWTO).toEqual(site.STATION_HOWTO);
  });
});

describe('the content', () => {
  it('is there for every station, with three steps and a tip', () => {
    for (const key of STATION_KEYS) {
      expect(STATION_HOWTO[key].summary).not.toBe('');
      expect(STATION_HOWTO[key].steps).toHaveLength(3);
      expect(STATION_HOWTO[key].tip).not.toBe('');
      expect(STATION_VIDEOS[key]).toMatch(/^[A-Za-z0-9_-]{11}$/);
    }
  });

  it('a video opens on YouTube', () => {
    expect(videoUrl('9RJiSvgaiJU')).toBe('https://www.youtube.com/watch?v=9RJiSvgaiJU');
    expect(videoUrl('a&b=c')).toBe('https://www.youtube.com/watch?v=a%26b%3Dc');
  });
});
