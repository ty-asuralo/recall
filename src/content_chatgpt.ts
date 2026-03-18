import { createExtractor } from './extractor';
import allSelectors from '../selectors.json';

createExtractor({
  platform: 'chatgpt',
  selectors: allSelectors.chatgpt,
  onMessage: (_message) => {
    // TODO: implement when chatgpt selectors are filled in
  },
});
