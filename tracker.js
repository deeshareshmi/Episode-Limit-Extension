(function (g) {
  'use strict';
  class PlaybackSampler {
    constructor() { this.previous = null; }
    reset() { this.previous = null; }
    sample(s) {
      const p = this.previous; this.previous = s;
      if (!p || p.key !== s.key || !p.playing || p.seeking || s.seeking || !s.eligible || !p.eligible) return 0;
      const wall = s.now-p.now, media = (s.position-p.position)*1000;
      // Count wall playback time, not seek distance or playback-rate-adjusted media time.
      if (wall <= 0 || wall > 5000 || media <= 0 || Math.abs(media-wall*p.rate) > Math.max(350,wall*.35)) return 0;
      return Math.min(wall, media/p.rate);
    }
  }
  g.PlaybackSampler = PlaybackSampler;
})(globalThis);
