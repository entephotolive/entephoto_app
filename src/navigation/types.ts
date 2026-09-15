import { NavigatorScreenParams } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

export type AuthStackParamList = {
  GoogleSignIn: undefined;
};

export type AppStackParamList = {
  Home: undefined;
  SelectEvent: undefined;
  CameraConnect:
    | {
        eventId?: string;
        eventTitle?: string;
        eventDate?: string;
        eventCategory?: string;
        coverImage?: string | null;
      }
    | undefined;
  CameraConnected:
    | {
        eventId?: string;
        eventTitle?: string;
        eventDate?: string;
        eventCategory?: string;
        coverImage?: string | null;
        cameraModel?: string;
        connectionType?: 'wifi' | 'usbc';
        photoCount?: number;
      }
    | undefined;
  PhotoSelectionGallery:
    | {
        eventId?: string;
        eventTitle?: string;
        eventDate?: string;
        eventCategory?: string;
        coverImage?: string | null;
        cameraModel?: string;
        photoCount?: number;
      }
    | undefined;
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  App: NavigatorScreenParams<AppStackParamList>;
};

export type AuthNavigationProp = NativeStackNavigationProp<AuthStackParamList>;
export type AppNavigationProp = NativeStackNavigationProp<AppStackParamList>;
