import { expect, test } from 'vitest';
import { canonicalCountry, continentsIn, countriesIn, countryIn, ideasFor, isCountryName, pickCountry } from './countries.ts';
import { dishIdeasFrom, fallbackDishes } from './food.ts';

test('a country whose name contains another is found whole, whatever the order', () => {
  // A first-match scan put NIGERIA on the map for "back to Niger".
  expect(countriesIn('Niger, then Nigeria')).toEqual(['Niger', 'Nigeria']);
  expect(countryIn('Papua New Guinea')).toBe('Papua New Guinea');
  expect(countryIn('off to South Sudan')).toBe('South Sudan');
  expect(countryIn('the Dominican Republic please')).toBe('Dominican Republic');
  expect(countryIn('Northern Ireland')).toBe('Northern Ireland');
  expect(countryIn('Guinea-Bissau')).toBe('Guinea-Bissau');
});

test('the names people actually say', () => {
  expect(countryIn('the UK')).toBe('United Kingdom');
  expect(countryIn('USA')).toBe('United States');
  expect(countryIn('Holland')).toBe('Netherlands');
  expect(countryIn('Türkiye')).toBe('Turkey');
  expect(countryIn("Côte d'Ivoire")).toBe('Ivory Coast');
});

test('a continent is never read as a country: "South America" is not the United States', () => {
  expect(countriesIn('somewhere in South America')).toEqual([]);
  expect(continentsIn('somewhere in South America')).toEqual(['South America']);
  expect(countriesIn('America')).toEqual(['United States']);
  expect(continentsIn('Southeast Asia, maybe')).toEqual(['Southeast Asia']);
});

test('words inside other words are not countries', () => {
  expect(countriesIn('I ran to go home and had a chat with a woman')).toEqual([]);
});

test('a country name, and nothing else', () => {
  expect(isCountryName('Japan')).toBe(true);
  expect(isCountryName('the Netherlands')).toBe(true);
  expect(isCountryName('Kyoto')).toBe(false);
  expect(canonicalCountry('uk')).toBe('United Kingdom');
  expect(canonicalCountry('Kyoto')).toBe('Kyoto');
});

test('ideas leave out where they have already been, and the pick is one of them', () => {
  expect(ideasFor('Europe', ['Portugal', 'Italy'])).not.toContain('Portugal');
  expect(ideasFor('Atlantis')).toContain('Japan'); // an unknown region falls back to the world
  expect(pickCountry('Europe', ['Portugal'], () => 0)).toBe('Italy');
  expect(pickCountry('Europe', ['Portugal'], () => 0.9999)).toBe('Norway');
});

test("the model's dishes are checked, and the built-in ones are there for the countries people pick most", () => {
  expect(dishIdeasFrom({ dishes: [{ name: 'Pastel de nata', description: 'A custard tart.', wikipediaTitle: 'Pastel de nata' }, { name: '' }, 'x'] }))
    .toEqual([{ name: 'Pastel de nata', description: 'A custard tart.', wiki: 'Pastel de nata' }]);
  expect(dishIdeasFrom(null)).toEqual([]);
  expect(fallbackDishes('Türkiye').map((d) => d.name)).toContain('Baklava');
  expect(fallbackDishes('Nepal')[0]).toEqual({ name: 'Momo', description: '', wiki: 'Momo (food)' });
  expect(fallbackDishes('Atlantis')).toEqual([]);
});
