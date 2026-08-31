import {describe,expect,it} from 'vitest';
import {haversineMeters,pointToLineDistanceMeters} from '../../supabase/functions/_shared/geo';
describe('route segment distance, not nearest vertex',()=>{
 it('recognizes a vehicle halfway along a long straight route',()=>{
  expect(pointToLineDistanceMeters({lat:0,lng:0.5},{type:'LineString',coordinates:[[0,0],[1,0]]})).toBeLessThan(0.01);
 });
 it('clamps the closest point to the segment endpoints',()=>{
  expect(pointToLineDistanceMeters({lat:0,lng:2},{type:'LineString',coordinates:[[0,0],[1,0]]})).toBeCloseTo(haversineMeters({lat:0,lng:1},{lat:0,lng:2}),4);
 });
 it('measures cross-track distance across the date line',()=>{
  expect(pointToLineDistanceMeters({lat:0.01,lng:180},{type:'LineString',coordinates:[[179,0],[-179,0]]})).toBeCloseTo(1111.949,2);
 });
 it('handles repeated points without NaN',()=>{
  expect(pointToLineDistanceMeters({lat:0,lng:0},{type:'LineString',coordinates:[[0,0],[0,0],[1,0]]})).toBe(0);
 });
});
