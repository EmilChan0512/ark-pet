#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>

extern void ark_pet_open_settings(void);

static NSMenu *ArkPetDockMenu(id self, SEL command, NSApplication *application) {
  (void)command;
  (void)application;
  NSMenu *menu = [[NSMenu alloc] initWithTitle:@"Ark Pet"];
  NSMenuItem *settings = [[NSMenuItem alloc] initWithTitle:@"Settings…"
                                                   action:@selector(arkPetOpenSettings:)
                                            keyEquivalent:@""];
  settings.target = self;
  [menu addItem:settings];
  return menu;
}

static void ArkPetOpenSettings(id target, SEL command, id sender) {
  (void)target;
  (void)command;
  (void)sender;
  ark_pet_open_settings();
}

void ark_pet_install_dock_menu(void) {
  NSApplication *application = NSApp;
  id delegate = application.delegate;
  if (delegate == nil) {
    NSLog(@"[window] unable to install the Dock menu: no application delegate");
    return;
  }

  Class delegateClass = [delegate class];
  SEL dockMenuSelector = @selector(applicationDockMenu:);
  SEL settingsSelector = @selector(arkPetOpenSettings:);

  if (!class_addMethod(delegateClass, dockMenuSelector, (IMP)ArkPetDockMenu, "@@:@")) {
    NSLog(@"[window] unable to install the Dock menu: applicationDockMenu: already exists");
    return;
  }

  class_addMethod(delegateClass, settingsSelector, (IMP)ArkPetOpenSettings, "v@:@");
}
