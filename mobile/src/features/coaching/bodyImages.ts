import type { ImageSourcePropType } from 'react-native';

/**
 * The body-type pictures the wizard shows: the website's own files (static/bodyfat), copied byte for byte into assets/bodyfat by
 * scripts/export_libraries.py's companion step and checked by tests/test_mobile_app.py. Metro needs each `require` spelled out.
 */
export const BODY_TYPE_IMAGES: Record<string, ImageSourcePropType> = {
  m1: require('../../../assets/bodyfat/m1.webp'),
  m2: require('../../../assets/bodyfat/m2.webp'),
  m3: require('../../../assets/bodyfat/m3.webp'),
  m4: require('../../../assets/bodyfat/m4.webp'),
  m5: require('../../../assets/bodyfat/m5.webp'),
  m6: require('../../../assets/bodyfat/m6.webp'),
  f1: require('../../../assets/bodyfat/f1.webp'),
  f2: require('../../../assets/bodyfat/f2.webp'),
  f3: require('../../../assets/bodyfat/f3.webp'),
  f4: require('../../../assets/bodyfat/f4.webp'),
  f5: require('../../../assets/bodyfat/f5.webp'),
  f6: require('../../../assets/bodyfat/f6.webp'),
};
