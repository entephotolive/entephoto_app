import React from 'react';
import { View, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Sun, Moon } from 'lucide-react-native';
import { AppStackParamList } from './types';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { useTheme } from '@/constants/theme';
import { useAuthStore } from '@/store/authStore';
import { authService } from '@/services/authService';
import { SelectEventScreen } from '@/screens/Events/SelectEventScreen';
import { CameraConnectScreen } from '@/screens/Camera/CameraConnectScreen';
import { CameraConnectedScreen } from '@/screens/Camera/CameraConnectedScreen';
import { PhotoSelectionGalleryScreen } from '@/screens/Gallery/PhotoSelectionGalleryScreen';
import { AppBackground } from '@/components/AppBackground';

const Stack = createNativeStackNavigator<AppStackParamList>();

const HomeScreen: React.FC = () => {
  const { colors, spacing, isDark, toggleTheme } = useTheme();
  const { user, logout } = useAuthStore();

  const handleLogout = async () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await authService.signOut();
          logout();
        },
      },
    ]);
  };

  return (
    <AppBackground>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.brand, { color: colors.textPrimary }]}>
            EntePhoto<Text style={{ color: colors.primary }}>.</Text>
          </Text>
          <Text variant="bodyXs" color={colors.textSecondary}>
            {user?.email ?? 'Photographer'}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={toggleTheme}
            style={[
              styles.themeIconBtn,
              { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Toggle Theme"
          >
            {isDark ? (
              <Sun size={18} color="#FBBF24" strokeWidth={2.2} />
            ) : (
              <Moon size={18} color={colors.primary} strokeWidth={2.2} />
            )}
          </TouchableOpacity>
          <Button
            label="Sign Out"
            variant="outline"
            size="sm"
            onPress={handleLogout}
            containerStyle={{ paddingHorizontal: spacing.md, borderRadius: 20 }}
          />
        </View>
      </View>

      {/* Body */}
      <View style={styles.center}>
        <Card elevated style={{ alignItems: 'center' }}>
          <Text variant="headlineMd" color={colors.textPrimary} align="center">
            Welcome{user?.name ? `, ${user.name}` : ''}! 👋
          </Text>
          <Text
            variant="bodySm"
            color={colors.textSecondary}
            align="center"
            style={{ marginTop: spacing.sm }}
          >
            Your event dashboard is coming soon.
          </Text>
          <Button
            label="Explore Events"
            variant="primary"
            size="md"
            containerStyle={{ marginTop: spacing.xl, width: '100%' }}
          />
        </Card>
      </View>
    </AppBackground>
  );
};

export const AppNavigator: React.FC = () => {
  return (
    <Stack.Navigator
      initialRouteName="PhotoSelectionGallery"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="SelectEvent" component={SelectEventScreen} />
      <Stack.Screen name="CameraConnect" component={CameraConnectScreen} />
      <Stack.Screen name="CameraConnected" component={CameraConnectedScreen} />
      <Stack.Screen name="PhotoSelectionGallery" component={PhotoSelectionGalleryScreen} />
      <Stack.Screen name="Home" component={HomeScreen} />
    </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 56,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  brand: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  themeIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
});
