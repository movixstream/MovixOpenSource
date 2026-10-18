#import <React/RCTViewManager.h>

// Voir AppDelegate.mm : l'en-tête généré déclare tout le module, y compris les
// classes qui héritent de RCTEventEmitter ou adoptent des protocoles AVKit,
// GoogleCast et WebKit. Ces frameworks doivent être importés avant.
#import <AVKit/AVKit.h>
#import <GoogleCast/GoogleCast.h>
#import <React/RCTEventEmitter.h>
#import <WebKit/WebKit.h>

#import "Movix-Swift.h"

@interface MovixGlassButtonManager : RCTViewManager
@end

@implementation MovixGlassButtonManager

RCT_EXPORT_MODULE(MovixGlassButton)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (UIView *)view
{
  return [[MovixGlassButton alloc] initWithFrame:CGRectZero];
}

RCT_EXPORT_VIEW_PROPERTY(title, NSString)
RCT_EXPORT_VIEW_PROPERTY(systemImage, NSString)
RCT_EXPORT_VIEW_PROPERTY(variant, NSString)
RCT_EXPORT_VIEW_PROPERTY(enabled, BOOL)
RCT_EXPORT_VIEW_PROPERTY(compact, BOOL)
RCT_EXPORT_VIEW_PROPERTY(label, NSString)
RCT_EXPORT_VIEW_PROPERTY(onButtonPress, RCTBubblingEventBlock)

@end
