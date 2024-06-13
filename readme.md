# Swap Variables for Figma

Just like Swap Libraries, but for variables.

![Swap Variables cover](https://github.com/qurle/swap-variables/blob/main/assets/cover.png?raw=true)

[Readme на русском](https://github.com/qurle/swap-variables/blob/main/readme-ru.md)

## How to use

Run it from the Quick Actions or Plugin menu.
Select some layers, choose source and destination variable collections and hit Swap button.

You can choose the scope for plugin: selection, current page, all pages or local styles.

After all, you may see some error. Click on them to focus viewport on problematic objects.

## How it works

Swap Variables will display all local and enabled external variable collections that actually contains variables.

When you swap these collections, plugin will recursively find every used variable, then check two things:

-   variable exists in source collection,
-   destination collection containt variable with same group and name.

After the plugin ends its job, it will display known ecnountered errors below Swap button.

## Known limitations

-   If you modified external libraries, reload page to apply changes.
-   Plugin can't swap styles. API for styles is very poor. Use [Swap Libraries](https://help.figma.com/hc/en-us/articles/4404856784663-Swap-style-and-component-libraries) instead.
-   Plugin can't swap variable in text with mixed fills. Do it manually instead.
-   Plugin can't swap fonts and gradients and strokes in section. That’s not supported by Figma API yet. Do it manually instead.
-   It may take some time to parse and swap variables when there're to many nodes or variables. Take a break and make some tea.
-   Scoped variables was not tested.

## Possible features

-   [x] Clickable error allows to zoom in problematic layers.
-   [x] Collections with 0 variables are hidden.
-   [x] Ability to create new local collection.
-   [x] Typographic variables.
-   [x] Rebinding modes if the share the same name.
-   [x] Multipage swap.
-   [x] Swapping variables in local styles.
-   [ ] Display number of variables in collection.
-   [ ] Selecting the option that's in second select makes them swap.

## Problem? Idea? Kind words?

I accept feature suggestions and ideas to improve the plugin. No need to mess with hidden layers? Swap all pages at once? Useful exceptions? If you have any ideas or issues, let me know in the comments.

Alternatively you can contact me via e-mail at [nikita.denisov@vk.team](mailto:nikita.denisov@vk.team?subject=Swap%20Variables) and [Telegram](https://t.me/qurle).

## <3
