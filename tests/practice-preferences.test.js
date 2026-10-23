import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePracticePreferences, practicePreference, practicePreferenceKey } from '../src/music/practice-preferences.js';

test('saved speeds survive JSON round trips independently for each song and profile', () => {
  const values = { [practicePreferenceKey('song-a','Ana')]: {speed:1,mode:'melody',hands:'right'},
    [practicePreferenceKey('song-b','Ana')]: {speed:.8}, [practicePreferenceKey('song-a','Bia')]: {speed:.6} };
  const restored=normalizePracticePreferences(JSON.parse(JSON.stringify(values)));
  assert.deepEqual(practicePreference(restored,'song-a','Ana'),{speed:1,mode:'melody',hands:'right'});
  assert.equal(practicePreference(restored,'song-b','Ana').speed,.8);
  assert.equal(practicePreference(restored,'song-a','Bia').speed,.6);
  assert.deepEqual(practicePreference(restored,'new-song','Ana'),{});
});

test('imported preferences reject invalid identities, speeds and playback settings', () => {
  const key=practicePreferenceKey('song','Ana');
  const restored=normalizePracticePreferences({bad:{speed:.7},'null':{speed:1},[key]:{speed:Infinity,mode:'unknown',hands:'none',loop:true,start:8,end:16}});
  assert.deepEqual(restored,{});
  for(const speed of [.2,1,1.5])assert.equal(normalizePracticePreferences({[key]:{speed}})[key].speed,speed);
  for(const speed of [.19,1.51,'1',null])assert.deepEqual(normalizePracticePreferences({[key]:{speed}}),{});
});
