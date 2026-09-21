import './global.css';
import { registerRootComponent } from 'expo';
import { setupGlobalErrorHandlers } from '@/utils/errorHandler';
import App from './App';

setupGlobalErrorHandlers();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
