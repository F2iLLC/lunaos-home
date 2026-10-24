package io.github.f2illc.lunaos.home.vehicle;

public final class VehicleGreetingsTest {
    private static void check(boolean value) { if (!value) throw new AssertionError(); }
    public static void main(String[] args) {
        check(args.length == 36);
        String[] periods = { "morning", "afternoon", "evening" };
        for (int index = 0; index < args.length; index++) {
            String period = periods[index / 12];
            VehicleGreetings.Choice selected = VehicleGreetings.choose(period, "Example", -1, args[index]);
            check(selected.id == index % 12); check(selected.text.equals(args[index].replace("{name}", "Example")));
            VehicleGreetings.Choice repeated = VehicleGreetings.choose(period, "Example", selected.id, args[index]);
            check(repeated.id != selected.id);
        }
        int lastId = -1;
        for (int n = 0; n < 300; n++) {
            // Restore only the previous ID, just as a newly started phone process does.
            VehicleGreetings.Choice choice = VehicleGreetings.choose(periods[n % 3], "Example", lastId, "You have two invented appointments.");
            check(choice.id != lastId); check(choice.id >= 0 && choice.id < 12);
            check(!choice.text.contains("appointment")); lastId = choice.id;
        }
        check(VehicleGreetings.validName("Example")); check(VehicleGreetings.validName("Example Two"));
        check(!VehicleGreetings.validName("\nExample")); check(!VehicleGreetings.validName("{name}"));
        check(!VehicleGreetings.validName("")); check(!VehicleGreetings.validName(new String(new char[41]).replace('\0', 'x')));
        boolean refused = false;
        try { VehicleGreetings.choose("morning", "bad\nname", -1, ""); } catch (IllegalArgumentException expected) { refused = true; }
        check(refused);
        System.out.println("VehicleGreetings: all 12 backend expressions match; consecutive repeats and arbitrary text refused across periods passed");
    }
}
