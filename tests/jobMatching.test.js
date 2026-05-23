import {
  distanceKm,
  getServiceMatchScore,
  getLocationMatchScore,
  calculateRankScore,
  rankBookingsForWorker,
} from '../utils/jobMatching.js';

describe('jobMatching', () => {
  const worker = {
    primaryServiceCategory: 'Plumbing',
    serviceCategories: ['Electrical'],
    latitude: 32.1617,
    longitude: 74.1883,
    location: 'Gujranwala, Model Town',
  };

  const nearBooking = {
    serviceCategory: 'Plumbing',
    category: 'Plumbing',
    serviceTitle: 'Pipe fix',
    latitude: 32.165,
    longitude: 74.19,
    createdAt: new Date(),
  };

  const farBooking = {
    serviceCategory: 'Plumbing',
    category: 'Plumbing',
    serviceTitle: 'Pipe fix',
    latitude: 33.7,
    longitude: 73.1,
    createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
  };

  const wrongService = {
    serviceCategory: 'Automotive',
    category: 'Automotive',
    serviceTitle: 'Oil change',
    latitude: 32.165,
    longitude: 74.19,
    createdAt: new Date(),
  };

  describe('distanceKm', () => {
    it('returns ~0 for same coordinates', () => {
      const d = distanceKm(
        { lat: 32.16, lng: 74.18 },
        { lat: 32.16, lng: 74.18 },
      );
      expect(d).toBeLessThan(0.01);
    });

    it('returns positive distance for different points', () => {
      const d = distanceKm(
        { lat: 32.1617, lng: 74.1883 },
        { lat: 33.7, lng: 73.1 },
      );
      expect(d).toBeGreaterThan(100);
    });
  });

  describe('getServiceMatchScore', () => {
    it('scores primary category highest', () => {
      const { score, exactService } = getServiceMatchScore(worker, nearBooking);
      expect(score).toBe(100);
      expect(exactService).toBe(true);
    });

    it('returns zero for unrelated service', () => {
      const { score } = getServiceMatchScore(worker, wrongService);
      expect(score).toBe(0);
    });
  });

  describe('getLocationMatchScore', () => {
    it('uses geo mode when coordinates exist', () => {
      const result = getLocationMatchScore(worker, nearBooking);
      expect(result.locationMode).toBe('geo');
      expect(result.distanceKm).toBeLessThan(5);
      expect(result.score).toBeGreaterThan(50);
    });
  });

  describe('rankBookingsForWorker', () => {
    it('ranks nearer matching jobs above farther ones', () => {
      const ranked = rankBookingsForWorker(
        worker,
        [farBooking, nearBooking, wrongService],
        { maxRadiusKm: 250 },
      );
      expect(ranked.length).toBe(2);
      expect(ranked[0]._distanceKm).toBeLessThan(ranked[1]._distanceKm);
      expect(ranked[0]._matchScore).toBeGreaterThanOrEqual(ranked[1]._matchScore);
    });

    it('excludes jobs beyond max radius', () => {
      const ranked = rankBookingsForWorker(worker, [farBooking, nearBooking], {
        maxRadiusKm: 10,
      });
      expect(ranked.length).toBe(1);
      expect(ranked[0]._distanceKm).toBeLessThan(10);
    });
  });

  describe('calculateRankScore', () => {
    it('returns null when service does not match', () => {
      expect(calculateRankScore(worker, wrongService)).toBeNull();
    });
  });
});
