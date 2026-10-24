import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateExperience, rewriteSentence } from '../src/lib/translator.js';

test('translates the example from the product brief', () => {
  const { bullets } = translateExperience('I worked on a school project with three people and created a website.');
  assert.deepEqual(bullets, ['Collaborated with a three-person team to develop a website as part of an academic project.']);
});

test('splits multiple sentences into separate bullets', () => {
  const { bullets } = translateExperience('I was a cashier at a grocery store. I helped customers find products.');
  assert.equal(bullets.length, 2);
  assert.equal(bullets[0], 'Worked as a cashier at a grocery store.');
  assert.equal(bullets[1], 'Helped customers find products.');
});

test('never invents numbers that were not in the input', () => {
  const inputs = [
    'I helped organize a bake sale with five volunteers.',
    'I was in charge of the robotics club social media.',
    'Me and my friends made a Discord bot using Python.',
    'I volunteer at the food bank on Saturdays.',
  ];
  for (const input of inputs) {
    const output = translateExperience(input).bullets.join(' ');
    assert.ok(!/\d/.test(output), `"${output}" should not contain digits`);
    assert.ok(!/%|increased|improved by|resulting in/i.test(output), `"${output}" should not claim results`);
  }
});

test('keeps who the user worked with accurate', () => {
  assert.equal(rewriteSentence('I helped organize a bake sale with five volunteers'), 'Helped organize a bake sale alongside five volunteers.');
  assert.equal(rewriteSentence('me and my friends made a discord bot'), 'Collaborated with my friends to create a discord bot.');
});

test('removes filler words and first-person subjects', () => {
  assert.equal(rewriteSentence('I basically just talked to customers about stuff'), 'Communicated with customers about tasks.');
});

test('returns prompts for missing detail instead of adding detail', () => {
  const { prompts } = translateExperience('I worked on a team project.', 'team');
  assert.ok(prompts.length > 0);
  assert.ok(prompts.every((p) => p.endsWith('.') || p.endsWith('?')));
});

test('handles empty input', () => {
  assert.deepEqual(translateExperience('').bullets, []);
});
