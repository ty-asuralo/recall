import { createExtractor } from './extractor';
import allSelectors from '../selectors.json';

createExtractor({
  platform: 'gemini',
  selectors: allSelectors.gemini,
  onMessage: (_message) => {
    // TODO: implement when gemini selectors are filled in
  },
});
