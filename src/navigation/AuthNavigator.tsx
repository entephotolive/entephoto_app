import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthStackParamList } from './types';
import { GoogleSignInScreen } from '@/screens/Auth/GoogleSignInScreen';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export const AuthNavigator: React.FC = () => {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="GoogleSignIn" component={GoogleSignInScreen} />
    </Stack.Navigator>
  );
};
